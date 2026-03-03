# Plan: Two-Way Calendar Sync

| Field | Value |
|---|---|
| **Author** | Beard (Lead/Architect) |
| **Status** | Draft — awaiting user review |
| **Priority** | P1 (RICE: 900) |
| **Spec** | docs/04-backlog-v2-v3.md, item 7c |
| **Origin** | Beta feedback from Tamer: "What happens if I change it in Google Calendar?" |

---

## Problem

Slotted creates Google Calendar events when meetups are confirmed (`autoAddToCalendar`), but changes made in Google Calendar never flow back. If a user declines, reschedules, or deletes a meetup from Google Calendar, Slotted still shows the meetup as confirmed — creating ghost plans.

## Current State (What Exists)

| Component | Status | Notes |
|---|---|---|
| Google Calendar write access | ✅ Shipped | `autoAddToCalendar()` creates events via `calendar.events.insert()` |
| `google_event_id` on `meetup_participants` | ✅ Shipped | Links GCal events to Slotted meetups |
| Webhook endpoint `POST /webhooks/google-calendar` | ✅ Scaffolded | Receives push notifications, looks up user by `calendar_watch_channel`, calls `syncUserCalendar()` |
| `calendar_watch_channel` / `calendar_watch_expiry` on `users` | ✅ Column exists | **Never populated** — `calendar.events.watch()` is never called |
| `syncUserCalendar()` | ✅ Works | Fetches all events, writes free/busy blocks to `availability`. **Does not inspect individual events for RSVP/time changes.** |
| Sync tokens | ❌ Missing | Full event list fetched every time. No incremental sync. |
| Event change detection | ❌ Missing | No diffing of Slotted meetup data vs. GCal event data. |
| Watch channel creation/renewal | ❌ Missing | The plumbing is there but the circuit isn't closed. |

**Key insight:** The webhook infrastructure is 80% scaffolded — the endpoint, the secret, the user lookup, even the DB columns. What's missing is (a) actually creating watch channels and (b) inspecting incoming changes for meetup-related events instead of just re-syncing availability.

---

## Architecture Design

### High-Level Flow

```
Google Calendar Event Changed
         │
         ▼
POST /webhooks/google-calendar
         │
         ├── (existing) Re-sync availability → `availability` table
         │
         └── (NEW) Fetch changed events via incremental sync token
                    │
                    ▼
              For each changed event:
                    │
                    ├── Match google_event_id → meetup_participants
                    │
                    ├── If RSVP changed → update participant RSVP
                    │       └── Send notification to other participants
                    │
                    ├── If event deleted → treat as "not this time"
                    │       └── Trigger decline flow (cancel if 1:1)
                    │
                    └── If time changed → flag for counter-propose
                            └── Notify meetup creator
```

### 1. Watch Channel Management

**When to create:** On calendar connect (`GET /calendar/callback`), after storing OAuth tokens.

**How:**
```typescript
// In /calendar/callback, after storing tokens and fetching calendar list:
const channelId = `slotted-${dbUser.id}-${Date.now()}`;
const watchRes = await calendarApi.events.watch({
  calendarId: 'primary',
  requestBody: {
    id: channelId,
    type: 'web_hook',
    address: `${WEBHOOK_BASE_URL}/webhooks/google-calendar`,
    token: GOOGLE_WEBHOOK_SECRET,
    expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  },
});

await supabase.from('users').update({
  calendar_watch_channel: channelId,
  calendar_watch_expiry: new Date(Number(watchRes.data.expiration)).toISOString(),
  calendar_watch_resource_id: watchRes.data.resourceId, // needed to stop channel
}).eq('id', dbUser.id);
```

**Renewal:** New scheduled function `renewCalendarWatchChannels` running every 6 hours. Finds users whose `calendar_watch_expiry` is within 24 hours and re-creates the watch.

**Teardown:** On `POST /calendar/disconnect`, stop the existing watch channel before clearing tokens.

### 2. Incremental Sync via Sync Tokens

Google Calendar API supports a `syncToken` — after an initial full fetch, subsequent calls with the sync token return only changed events. This is dramatically more efficient than fetching all events on each webhook.

**New column:** `calendar_sync_token TEXT` on `users` table.

**Flow:**
1. First sync (or token expired): Full fetch, store `nextSyncToken` from response.
2. Subsequent webhook-triggered syncs: Pass `syncToken` parameter, get only changes.
3. If sync token is invalidated (410 Gone): Fall back to full fetch, store new token.

### 3. Event Change Detection (Core Logic)

New function: `processCalendarChanges(firebaseUid, changedEvents)`

For each changed event:

```
1. Look up google_event_id in meetup_participants
2. If no match → skip (not a Slotted event, just an availability change)
3. If match found:
   a. EVENT DELETED (status === 'cancelled'):
      → Update participant RSVP to 'declined'
      → Trigger existing decline flow (cancel if 1:1, notify others)
      → Notification: "[Name] is no longer available for [Title]"

   b. RSVP CHANGED (attendee responseStatus differs):
      Google 'accepted'  → Slotted 'accepted'
      Google 'declined'  → Slotted 'declined'
      Google 'tentative' → Slotted 'maybe'
      Google 'needsAction' → no change (initial state)
      → Reuse existing RSVP update logic from PATCH /meetups/:id/rsvp

   c. TIME CHANGED (start/end differs from meetup start/end):
      → If user is the meetup creator: update the meetup time for everyone
      → If user is NOT the creator: flag as counter-propose
      → Notification to creator: "[Name] moved their calendar event
         to [new time] — want to update the meetup?"

   d. TITLE/LOCATION CHANGED:
      → Ignore. Slotted is source of truth for meetup metadata.
```

### 4. Conflict Resolution Rules

| Scenario | Source of Truth | Action |
|---|---|---|
| Individual RSVP change | Google Calendar | Update `meetup_participants.rsvp`, notify others |
| Event deletion | Google Calendar | Treat as "declined", trigger decline flow |
| Time change by creator | Google Calendar | Update `meetups.start_time`/`end_time`, notify participants |
| Time change by non-creator | Slotted (meetup time unchanged) | Notify creator as counter-propose suggestion |
| Title/location/description change | Slotted | Ignore calendar changes to metadata |
| New participant added in GCal | Slotted | Ignore — invites go through Slotted only |
| Meetup cancelled in Slotted | Slotted | Delete GCal event for all participants |

### 5. Schema Changes

```sql
-- Migration: two_way_calendar_sync.sql

-- 1. Sync token for incremental sync
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_sync_token TEXT;

-- 2. Resource ID needed to stop watch channels
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_watch_resource_id TEXT;

-- 3. Track when each participant's GCal event was last synced
--    Prevents re-processing the same change
ALTER TABLE meetup_participants
  ADD COLUMN IF NOT EXISTS gcal_etag TEXT,
  ADD COLUMN IF NOT EXISTS gcal_last_synced_at TIMESTAMPTZ;

-- 4. Track sync-originated RSVP changes to prevent feedback loops
--    When we update RSVP from a webhook, we must NOT push that change
--    back to Google Calendar (which would trigger another webhook).
ALTER TABLE meetup_participants
  ADD COLUMN IF NOT EXISTS rsvp_source TEXT DEFAULT 'app'
    CHECK (rsvp_source IN ('app', 'google_calendar', 'apple_calendar'));

-- 5. Add notification types for calendar sync events
-- (Update the CHECK constraint on notifications.type)
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'friend_accepted', 'friend_request',
    'meetup_request', 'meetup_confirmed', 'meetup_reminder',
    'calendar_match',
    'meetup_rsvp_changed',     -- NEW: RSVP changed via calendar
    'meetup_time_changed',     -- NEW: Time changed via calendar
    'meetup_counter_propose'   -- NEW: Non-creator moved their event
  ));
```

### 6. API Changes

| Endpoint | Method | Change |
|---|---|---|
| `GET /calendar/callback` | Existing | **Add:** Create watch channel after storing tokens |
| `POST /webhooks/google-calendar` | Existing | **Add:** After availability sync, run `processCalendarChanges()` for meetup-linked events |
| `POST /calendar/disconnect` | Existing | **Add:** Stop watch channel before clearing tokens |
| `POST /calendar/sync` | Existing | **Add:** Store sync token from response |
| `PATCH /meetups/:meetupId/rsvp` | Existing | **Add:** Set `rsvp_source = 'app'` to prevent feedback loops |

**No new public endpoints.** The webhook endpoint already exists.

### 7. Feedback Loop Prevention

This is the most critical correctness concern. Without it:
1. User declines in Google Calendar
2. Webhook fires → Slotted updates RSVP to "declined"
3. Slotted pushes RSVP change back to Google Calendar (if we ever add that)
4. Google sends another webhook → infinite loop

**Solution:** The `rsvp_source` column tracks where the last RSVP change originated. When processing a webhook-originated change:
- Set `rsvp_source = 'google_calendar'`
- Skip the change if the current `rsvp` already matches and `rsvp_source = 'google_calendar'`

When processing an app-originated change (user clicks accept/decline in Slotted):
- Set `rsvp_source = 'app'`
- (Future: push to Google Calendar if we add RSVP push-back)

### 8. Edge Cases

| Edge Case | Handling |
|---|---|
| **User disconnects calendar** | Stop watch channel. Meetup data preserved. RSVP still editable in Slotted. |
| **Watch channel expires (missed renewal)** | Scheduled function catches up within 6 hours. Gap: changes during that window are picked up on next manual sync. |
| **Google API quota exceeded** | Log and retry on next webhook. Exponential backoff in `processCalendarChanges`. |
| **Event modified by someone else** (shared calendar) | We only match by `google_event_id` which maps to the specific user's calendar copy. Shared calendar edits by non-participants are ignored. |
| **Recurring events** | **Phase 1: Out of scope.** Slotted doesn't create recurring events, so `google_event_id` always points to a single event. Recurring events in the user's calendar are handled by existing availability sync. |
| **User accepts in both Slotted and GCal** | Idempotent. If RSVP is already "accepted", the webhook-triggered update is a no-op. |
| **Meetup already cancelled in Slotted** | Webhook-triggered RSVP change is ignored for cancelled meetups. |
| **Multiple GCal events for same meetup** | Prevented by existing `existingPart?.google_event_id` check in `autoAddToCalendar`. |

### 9. Privacy Analysis

| Concern | Assessment |
|---|---|
| **Does webhook expose calendar data to friends?** | No. Webhook data stays server-side. Friends only see RSVP changes through Slotted's existing notification system. |
| **Does the sync reveal event details?** | No. We only inspect events matching our `google_event_id`. We extract RSVP status and time — never titles, attendees, or locations from *other* events. |
| **Notification language** | Follows Slotted's soft social dynamics. "Alex updated their RSVP to maybe" not "Alex declined." Deletion → "Alex is no longer available" not "Alex deleted your event." |
| **Can friends see that a change came from Google Calendar vs. the app?** | No. The `rsvp_source` column is internal. Notifications look identical regardless of source. |

**Verdict: No new privacy risks.** Two-way sync actually *reduces* information asymmetry — previously, a user could decline in Google Calendar without anyone in Slotted knowing.

---

## Phased Implementation

### Phase 1: Wire Up Watch Channels (Foundation)
**Effort:** 2–3 days | **Risk:** Low | **Value:** Enables real-time sync instead of manual-only

- [ ] Add `calendar_sync_token` and `calendar_watch_resource_id` columns to `users` table
- [ ] Create watch channel in `GET /calendar/callback` after OAuth token exchange
- [ ] Store `calendar_watch_channel`, `calendar_watch_expiry`, `calendar_watch_resource_id`
- [ ] Stop watch channel in `POST /calendar/disconnect`
- [ ] New scheduled function: `renewCalendarWatchChannels` (every 6 hours)
  - Find users with `calendar_watch_expiry` within 24 hours
  - Stop old channel, create new one
  - Update stored channel ID and expiry
- [ ] Update `syncUserCalendar()` to use and store sync tokens for incremental sync
- [ ] Test: Connect calendar → verify webhook fires on GCal change → availability updates

### Phase 2: RSVP & Deletion Sync (Core Feature)
**Effort:** 3–4 days | **Risk:** Medium (feedback loops) | **Value:** Eliminates ghost plans

- [ ] Add `gcal_etag`, `gcal_last_synced_at`, `rsvp_source` columns to `meetup_participants`
- [ ] Update notification type CHECK constraint
- [ ] New function: `processCalendarChanges(firebaseUid, changedEvents[])`
  - Match events by `google_event_id`
  - Handle deleted events (RSVP → declined)
  - Handle RSVP status changes
  - Set `rsvp_source = 'google_calendar'`
- [ ] Integrate into webhook handler: after `syncUserCalendar()`, run `processCalendarChanges()`
- [ ] Update `PATCH /meetups/:meetupId/rsvp` to set `rsvp_source = 'app'`
- [ ] Add notifications for calendar-originated RSVP changes
  - Soft language: "is no longer available" not "declined"
- [ ] Test: Accept meetup → auto-add to GCal → decline in GCal → verify Slotted updates

### Phase 3: Time Change Detection (Counter-Propose)
**Effort:** 2–3 days | **Risk:** Medium (UX design needed) | **Value:** Handles the "I moved it to Sunday instead" case

- [ ] Detect time changes: compare event `start`/`end` to meetup `start_time`/`end_time`
- [ ] Creator time change: update meetup, notify all participants
- [ ] Non-creator time change: create counter-propose notification
  - "Alex moved their calendar event to Sunday 3pm — want to update the meetup?"
  - Include accept/dismiss actions in notification (future: requires counter-propose UI)
- [ ] Test: Move GCal event to new time → verify correct notification flow

### Phase 4: Hardening & Apple Calendar (Future)
**Effort:** 1–2 weeks | **Risk:** High (CalDAV complexity) | **Value:** Completes multi-platform story

- [ ] Rate limiting and exponential backoff for Google API calls
- [ ] Monitoring: log sync latency, failure rates, quota usage
- [ ] Apple Calendar polling via scheduled function (every 10 min)
  - CalDAV REPORT for changes since last sync
  - Match by deterministic UID pattern
- [ ] Integration tests for full webhook → RSVP update → notification flow

---

## File-by-File Changes

### `functions/src/index.ts`

**1. Watch channel creation in `/calendar/callback`** (~20 lines)

After the existing calendar list fetch/store block, add:
```typescript
// Set up push notification channel for real-time sync
try {
  const channelId = `slotted-${dbUser.id}-${Date.now()}`;
  const watchRes = await calendar.events.watch({
    calendarId: 'primary',
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: `${process.env.WEBHOOK_BASE_URL || 'https://slotted-ai.web.app/api'}/webhooks/google-calendar`,
      token: GOOGLE_WEBHOOK_SECRET,
      expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  await getSupabase().from('users').update({
    calendar_watch_channel: channelId,
    calendar_watch_expiry: new Date(Number(watchRes.data.expiration)).toISOString(),
    calendar_watch_resource_id: watchRes.data.resourceId,
  }).eq('id', dbUser.id);
} catch (watchErr) {
  console.error('Failed to set up calendar watch:', watchErr);
}
```

**2. Watch channel teardown in `/calendar/disconnect`** (~15 lines)

Before clearing tokens, stop the watch channel:
```typescript
if (dbUser.calendar_watch_channel && dbUser.calendar_watch_resource_id) {
  try {
    const oauth2 = await getAuthedCalendarClient(req.uid!);
    if (oauth2) {
      const calendarApi = google.calendar({ version: 'v3', auth: oauth2 });
      await calendarApi.channels.stop({
        requestBody: {
          id: dbUser.calendar_watch_channel,
          resourceId: dbUser.calendar_watch_resource_id,
        },
      });
    }
  } catch (stopErr) {
    console.error('Failed to stop calendar watch:', stopErr);
  }
}
```

**3. `processCalendarChanges()` function** (~80 lines, new)

```typescript
async function processCalendarChanges(
  firebaseUid: string,
  changedEvents: calendar_v3.Schema$Event[]
): Promise<void> {
  const sb = getSupabase();
  const dbUser = await getDbUser(firebaseUid);
  if (!dbUser) return;

  for (const event of changedEvents) {
    if (!event.id) continue;

    // Find meetup participant linked to this GCal event
    const { data: participant } = await sb
      .from('meetup_participants')
      .select('id, meetup_id, user_id, rsvp, rsvp_source, gcal_etag')
      .eq('google_event_id', event.id)
      .eq('user_id', dbUser.id)
      .single();

    if (!participant) continue; // Not a Slotted meetup event

    // Skip if etag unchanged (already processed)
    if (event.etag && participant.gcal_etag === event.etag) continue;

    // Fetch meetup data
    const { data: meetup } = await sb
      .from('meetups')
      .select('id, title, status, start_time, end_time, created_by')
      .eq('id', participant.meetup_id)
      .single();

    if (!meetup || ['cancelled', 'completed'].includes(meetup.status)) continue;

    // --- DELETION ---
    if (event.status === 'cancelled') {
      if (participant.rsvp !== 'declined') {
        await updateRsvpFromCalendar(participant, meetup, dbUser, 'declined');
      }
      continue;
    }

    // --- RSVP CHANGE ---
    const myAttendee = (event.attendees || []).find(
      a => a.email === dbUser.email || a.self
    );
    if (myAttendee?.responseStatus) {
      const mappedRsvp = mapGoogleRsvp(myAttendee.responseStatus);
      if (mappedRsvp && mappedRsvp !== participant.rsvp) {
        await updateRsvpFromCalendar(participant, meetup, dbUser, mappedRsvp);
      }
    }

    // --- TIME CHANGE (Phase 3) ---
    // Compare event start/end to meetup start/end
    // Route to counter-propose or direct update depending on creator

    // Update etag to prevent re-processing
    await sb.from('meetup_participants').update({
      gcal_etag: event.etag,
      gcal_last_synced_at: new Date().toISOString(),
    }).eq('id', participant.id);
  }
}

function mapGoogleRsvp(googleStatus: string): string | null {
  switch (googleStatus) {
    case 'accepted': return 'accepted';
    case 'declined': return 'declined';
    case 'tentative': return 'maybe';
    case 'needsAction': return null; // No change
    default: return null;
  }
}

async function updateRsvpFromCalendar(
  participant: any, meetup: any, dbUser: any, newRsvp: string
): Promise<void> {
  const sb = getSupabase();

  await sb.from('meetup_participants').update({
    rsvp: newRsvp,
    rsvp_source: 'google_calendar',
  }).eq('id', participant.id);

  // Reuse existing decline/confirm logic
  if (newRsvp === 'declined') {
    // Fetch all participants to check if 1:1 auto-cancel applies
    const { data: allParticipants } = await sb
      .from('meetup_participants')
      .select('user_id, rsvp')
      .eq('meetup_id', meetup.id);

    if (allParticipants && allParticipants.length <= 2) {
      await sb.from('meetups')
        .update({ status: 'cancelled' })
        .eq('id', meetup.id);
    }

    // Notify other participants
    for (const p of (allParticipants || [])) {
      if (p.user_id !== dbUser.id) {
        await createNotification({
          userId: p.user_id,
          type: 'meetup_rsvp_changed',
          title: `${dbUser.display_name || 'Someone'} is no longer available`,
          body: meetup.title || 'Hangout',
          relatedUserId: dbUser.id,
          relatedId: meetup.id,
        });
      }
    }
  } else if (newRsvp === 'maybe') {
    // Notify meetup creator
    if (meetup.created_by !== dbUser.id) {
      await createNotification({
        userId: meetup.created_by,
        type: 'meetup_rsvp_changed',
        title: `🤔 ${dbUser.display_name || 'Someone'} is now a maybe`,
        body: meetup.title || 'Hangout',
        relatedUserId: dbUser.id,
        relatedId: meetup.id,
      });
    }
  }
  // 'accepted' from calendar is a happy path — notify creator
  else if (newRsvp === 'accepted' && meetup.created_by !== dbUser.id) {
    await createNotification({
      userId: meetup.created_by,
      type: 'meetup_confirmed',
      title: `✅ ${dbUser.display_name || 'Someone'} accepted`,
      body: meetup.title || 'Hangout',
      relatedUserId: dbUser.id,
      relatedId: meetup.id,
    });
  }
}
```

**4. Update webhook handler** (~15 lines)

In the existing `POST /webhooks/google-calendar`, after `syncUserCalendar()`:
```typescript
// NEW: Process meetup-related changes
const oauth2 = await getAuthedCalendarClient(user.firebase_uid);
if (oauth2) {
  const calendarApi = google.calendar({ version: 'v3', auth: oauth2 });
  const dbUser = await getDbUser(user.firebase_uid);
  try {
    const eventsRes = await calendarApi.events.list({
      calendarId: 'primary',
      syncToken: dbUser?.calendar_sync_token || undefined,
      maxResults: 50,
    });
    if (eventsRes.data.items) {
      await processCalendarChanges(user.firebase_uid, eventsRes.data.items);
    }
    // Store new sync token
    if (eventsRes.data.nextSyncToken) {
      await getSupabase().from('users').update({
        calendar_sync_token: eventsRes.data.nextSyncToken,
      }).eq('firebase_uid', user.firebase_uid);
    }
  } catch (syncErr: any) {
    if (syncErr?.code === 410) {
      // Sync token expired — clear it, full sync will happen next time
      await getSupabase().from('users').update({
        calendar_sync_token: null,
      }).eq('firebase_uid', user.firebase_uid);
    }
    console.error('Incremental sync error:', syncErr);
  }
}
```

**5. New scheduled function: `renewCalendarWatchChannels`** (~40 lines)

```typescript
export const renewCalendarWatchChannels = onSchedule("every 6 hours", async () => {
  const sb = getSupabase();
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: users } = await sb.from('users')
    .select('id, firebase_uid, calendar_watch_channel, calendar_watch_resource_id')
    .not('google_refresh_token', 'is', null)
    .lt('calendar_watch_expiry', cutoff);

  for (const user of (users || [])) {
    try {
      const oauth2 = await getAuthedCalendarClient(user.firebase_uid);
      if (!oauth2) continue;
      const calendarApi = google.calendar({ version: 'v3', auth: oauth2 });

      // Stop old channel
      if (user.calendar_watch_channel && user.calendar_watch_resource_id) {
        await calendarApi.channels.stop({
          requestBody: {
            id: user.calendar_watch_channel,
            resourceId: user.calendar_watch_resource_id,
          },
        }).catch(() => {}); // Ignore errors on old channel
      }

      // Create new channel
      const channelId = `slotted-${user.id}-${Date.now()}`;
      const watchRes = await calendarApi.events.watch({
        calendarId: 'primary',
        requestBody: {
          id: channelId,
          type: 'web_hook',
          address: `${process.env.WEBHOOK_BASE_URL || 'https://slotted-ai.web.app/api'}/webhooks/google-calendar`,
          token: GOOGLE_WEBHOOK_SECRET,
          expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await sb.from('users').update({
        calendar_watch_channel: channelId,
        calendar_watch_expiry: new Date(Number(watchRes.data.expiration)).toISOString(),
        calendar_watch_resource_id: watchRes.data.resourceId,
      }).eq('id', user.id);

      console.log(`Renewed watch channel for user ${user.id}`);
    } catch (err) {
      console.error(`Failed to renew watch for user ${user.id}:`, err);
    }
  }
});
```

### `database/schema.sql`

No changes — schema.sql is the canonical bootstrap. The new columns are added via migration.

### `migrations/two_way_calendar_sync.sql` (New)

See SQL in Schema Changes section above.

### `client/src/lib/api.ts`

No changes needed. The two-way sync is entirely server-driven. No new frontend API calls.

### `client/` (Frontend)

**Minimal changes in Phase 1–2:**
- Notification rendering in `NotificationsPage.tsx`: Add handling for new notification types (`meetup_rsvp_changed`, `meetup_time_changed`, `meetup_counter_propose`)
- These map to existing notification card UI — just need the type → icon/action mapping

**Phase 3 (counter-propose):**
- Counter-propose UI on notification cards (accept new time / keep original)
- This is a separate feature that may need its own plan

---

## Trade-offs & Alternatives Considered

### Webhooks vs. Polling

| | Webhooks (chosen) | Polling |
|---|---|---|
| **Latency** | Near real-time (seconds) | 5–15 min delay |
| **Complexity** | Higher (channel management, renewal) | Lower (simple cron) |
| **Cost** | Lower (event-driven, no wasted API calls) | Higher (constant API calls) |
| **Reliability** | Requires channel renewal, can miss changes in gaps | Consistent but delayed |

**Decision:** Webhooks for Google (supports it natively), polling for Apple (no webhook support).

### Per-User vs. Per-Calendar Watch Channels

| | Per-user (one channel on 'primary') | Per-calendar (one channel per selected calendar) |
|---|---|---|
| **Complexity** | Low — one watch to manage | High — N watches per user |
| **Coverage** | Misses changes on non-primary calendars | Full coverage |
| **Quota** | Low | Could hit Google quota limits |

**Decision:** Per-user on 'primary' calendar for Phase 1. Slotted creates events on 'primary' only, so that's where RSVP/time changes will appear. Expand to per-calendar if users report missed changes.

### Sync Token vs. Full Fetch + Diff

| | Sync tokens (chosen) | Full fetch + hash comparison |
|---|---|---|
| **API calls** | 1 call returning only changes | 1 call returning all events |
| **Bandwidth** | Minimal | Up to 2500 events per page |
| **Complexity** | Medium (token management, 410 handling) | Lower but wasteful |

**Decision:** Sync tokens. Google API is designed for this. The 410 handling is well-documented.

### Notification Type: New Types vs. Reusing Existing

**Decision:** New types (`meetup_rsvp_changed`, `meetup_time_changed`). This allows the frontend to render different copy/icons for calendar-originated changes vs. in-app changes, even though the user never sees the distinction explicitly. It also helps with analytics — we can track how often RSVPs come from Google Calendar vs. the app.

---

## Dependencies

- `google_event_id` column on `meetup_participants` — ✅ already shipped
- `autoAddToCalendar()` — ✅ already shipped
- `POST /webhooks/google-calendar` endpoint — ✅ already scaffolded
- `GOOGLE_WEBHOOK_SECRET` environment variable — ✅ already configured
- `WEBHOOK_BASE_URL` environment variable — **needs to be set** (or hardcode `https://slotted-ai.web.app/api`)
- Google Calendar API quota: push notification channels count against quota. At current scale (~20 users), this is negligible.

---

## Todo List

### Phase 1: Watch Channel Foundation
- [ ] Write migration `migrations/two_way_calendar_sync.sql`
- [ ] Run migration against Supabase
- [ ] Add watch channel creation to `GET /calendar/callback`
- [ ] Add watch channel teardown to `POST /calendar/disconnect`
- [ ] Add `renewCalendarWatchChannels` scheduled function
- [ ] Update `syncUserCalendar()` to store/use sync tokens
- [ ] Manual test: connect calendar → verify watch channel created → change GCal event → verify webhook fires
- [ ] Build functions: `cd functions && npm run build`

### Phase 2: RSVP & Deletion Sync
- [ ] Implement `processCalendarChanges()` function
- [ ] Implement `updateRsvpFromCalendar()` helper
- [ ] Implement `mapGoogleRsvp()` helper
- [ ] Integrate into `POST /webhooks/google-calendar` handler
- [ ] Update `PATCH /meetups/:meetupId/rsvp` to set `rsvp_source = 'app'`
- [ ] Add notification type handling in frontend (`NotificationsPage.tsx`)
- [ ] Test: Accept meetup → auto-add to GCal → decline in GCal → verify Slotted updates
- [ ] Test: Accept meetup → decline in Slotted → verify no feedback loop
- [ ] Test: Meetup already cancelled → GCal change → verify no-op
- [ ] Build and type-check: `cd functions && npm run build && cd ../client && npx tsc --noEmit`

### Phase 3: Time Change Detection
- [ ] Add time comparison logic to `processCalendarChanges()`
- [ ] Creator time change → update meetup for all participants
- [ ] Non-creator time change → counter-propose notification
- [ ] Frontend: counter-propose notification card with accept/dismiss
- [ ] Test time change scenarios

### Phase 4: Hardening & Apple (Future)
- [ ] Rate limiting on Google API calls in webhook handler
- [ ] Monitoring/logging for sync metrics
- [ ] Apple Calendar polling scheduled function
- [ ] Integration tests
