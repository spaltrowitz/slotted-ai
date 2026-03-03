# Test Scenarios: Two-Way Calendar Sync

**Author:** Nate (QA)
**Status:** Anticipatory — written before implementation; may need adjustment once Beard's architecture is final
**Date:** 2025-02-27
**Spec reference:** `docs/04-backlog-v2-v3.md` §7c
**Schema reference:** `database/schema.sql`, `migrations/add_google_event_id.sql`, `migrations/add_calendar_sync_tracking.sql`

---

## Key Schema Facts (Current State)

These columns already exist or are migrated and inform test design:

| Table | Column | Purpose |
|-------|--------|---------|
| `users` | `calendar_watch_channel` | Google push notification channel ID |
| `users` | `calendar_watch_expiry` | Channel expiration timestamp |
| `users` | `calendar_watch_resource_id` | Needed to stop/renew channels |
| `users` | `calendar_sync_token` | Incremental sync token for `events.list` |
| `users` | `apple_last_sync_at` | Last CalDAV poll timestamp |
| `meetup_participants` | `google_event_id` | Links Google Calendar event to participant row |
| `meetup_participants` | `calendar_source` | `'google'` / `'apple'` / `NULL` |

**Conflict resolution rule from spec:** Slotted = source of truth for multi-party state. Calendar = source of truth for individual RSVP and personal time changes.

---

## 1. Happy Path Scenarios

### 1.1 Google Calendar RSVP → Slotted RSVP Update

| Field | Detail |
|-------|--------|
| **ID** | HP-01 |
| **Preconditions** | User A and User B have a confirmed meetup. User A has `google_event_id` set on their `meetup_participants` row. User A's watch channel is active (`calendar_watch_expiry` > now). |
| **Action** | User A changes RSVP to "declined" in Google Calendar. Google sends push notification to `POST /calendar/webhook`. Server fetches event via incremental sync, reads `attendees[].responseStatus = 'declined'`. |
| **Expected Result** | `meetup_participants.rsvp` for User A updates to `'declined'`. If User A was the only other participant, `meetups.status` may update to `'cancelled'`. A notification is created for User B: "User A updated their RSVP." |
| **Principle** | Soft social dynamics — notification should say "not this time" rather than "declined." |

### 1.2 Google Calendar RSVP "Maybe" → Slotted "Maybe"

| Field | Detail |
|-------|--------|
| **ID** | HP-02 |
| **Preconditions** | Same as HP-01, RSVP currently `'accepted'`. |
| **Action** | User A sets RSVP to "tentative" (maybe) in Google Calendar. |
| **Expected Result** | `meetup_participants.rsvp` updates to `'maybe'`. Notification to other participants uses soft language: "might not make it" or "is unsure about." |
| **Principle** | Soft social dynamics — no pressure language. |

### 1.3 Google Calendar Time Change → Slotted Detects Drift

| Field | Detail |
|-------|--------|
| **ID** | HP-03 |
| **Preconditions** | Confirmed meetup between A and B. Google event `start`/`end` matches `meetups.start_time`/`end_time`. |
| **Action** | User A drags the event to a different time in Google Calendar. Webhook fires. Server detects `event.start` ≠ `meetups.start_time`. |
| **Expected Result** | Per spec: only User A's participant record is flagged — the meetup time does NOT change for everyone. System should either: (a) prompt User A to counter-propose the new time, or (b) revert User A's calendar event to the original time and notify them. The meetup itself is NOT silently moved. |
| **Principle** | Slotted is source of truth for multi-party state. One person dragging an event shouldn't silently reschedule for the group. |

### 1.4 Google Calendar Event Deleted → Slotted Treats as Decline

| Field | Detail |
|-------|--------|
| **ID** | HP-04 |
| **Preconditions** | Confirmed meetup. User A has `google_event_id` on their participant row. |
| **Action** | User A deletes the event from Google Calendar. Webhook fires. Incremental sync returns the event as `status: 'cancelled'`. |
| **Expected Result** | `meetup_participants.rsvp` for User A → `'declined'`. Meetup is NOT cancelled unless all participants have declined. Notification to other participants uses soft language. |
| **Principle** | Soft social dynamics — deletion = "not this time," not a hard cancel for everyone. |

### 1.5 Friend Accepts in Slotted → Google Calendar Event Created (Existing One-Way)

| Field | Detail |
|-------|--------|
| **ID** | HP-05 |
| **Preconditions** | User B receives meetup proposal. User B has Google Calendar connected with write scope. |
| **Action** | User B clicks "Accept" in Slotted. |
| **Expected Result** | `meetup_participants.rsvp` → `'accepted'`. Google Calendar event auto-created on User B's calendar. `google_event_id` stored on their participant row. `calendar_source` set to `'google'`. This is the existing one-way flow — verify it still works after two-way sync is added. |
| **Principle** | Reduce friction at moments of excitement — event appears instantly on accept. |

### 1.6 Google Calendar "Accepted" RSVP → Slotted Accepted

| Field | Detail |
|-------|--------|
| **ID** | HP-06 |
| **Preconditions** | User A has a pending meetup with a Google Calendar event already created (auto-add on proposal). RSVP in Slotted is `'pending'`. |
| **Action** | User A taps "Yes" on the Google Calendar event. |
| **Expected Result** | `meetup_participants.rsvp` → `'accepted'`. If all participants have accepted, `meetups.status` → `'confirmed'`. Notification to proposer. |
| **Principle** | Users can manage from wherever they are — phone calendar, desktop, or Slotted app. |

---

## 2. Conflict Scenarios

### 2.1 Simultaneous Modification in Slotted and Google Calendar

| Field | Detail |
|-------|--------|
| **ID** | CF-01 |
| **Preconditions** | Confirmed meetup. User A has both Slotted and Google Calendar open. |
| **Action** | User A declines in Slotted at T=0. At T=1 (before webhook processes), they also change the time in Google Calendar. Webhook arrives at T=2. |
| **Expected Result** | Slotted's decline (T=0) should already be recorded. When the webhook arrives with the time change (T=2), the system should recognize the RSVP is already `'declined'` and ignore the time change from Google. Last-write-wins for RSVP, but Slotted direct actions take priority over webhook-derived actions. |
| **Principle** | Slotted is source of truth for multi-party state. |

### 2.2 Event Deleted in Google While Being Counter-Proposed in Slotted

| Field | Detail |
|-------|--------|
| **ID** | CF-02 |
| **Preconditions** | User A has a pending meetup. User B is mid-counter-propose flow in Slotted. |
| **Action** | User A deletes the Google Calendar event. Webhook arrives while User B's counter-propose is in-flight. |
| **Expected Result** | User A's RSVP → `'declined'`. User B's counter-propose should still succeed (it creates a new time proposal). User B should be notified that User A bailed. The counter-propose doesn't crash or produce orphaned state. |

### 2.3 Time Zone Change on Google Calendar Event

| Field | Detail |
|-------|--------|
| **ID** | CF-03 |
| **Preconditions** | Meetup at "2025-03-15T19:00:00-05:00" (EST). User A's Google Calendar is in EST. |
| **Action** | User A travels and Google Calendar auto-adjusts display timezone to PST. User A sees the event at 4pm PST (same absolute time) but manually moves it to 7pm PST (10pm EST). Webhook fires. |
| **Expected Result** | Server compares absolute timestamps (UTC), not display times. Detects the actual 3-hour shift. Flags as a time change, not a no-op. Should trigger the same flow as HP-03 (individual time drift detected). |

### 2.4 All-Day Event Conversion

| Field | Detail |
|-------|--------|
| **ID** | CF-04 |
| **Preconditions** | Timed meetup (e.g., 2pm-4pm Saturday). |
| **Action** | User A converts the Google Calendar event to "all-day" (removes specific start/end times). |
| **Expected Result** | System should treat this as a significant change. Options: (a) ignore the all-day conversion and keep Slotted's specific time, or (b) flag it as a conflict for the user to resolve. Must NOT silently convert the meetup to an all-day event for all participants. |

### 2.5 Webhook Arrives for Already-Cancelled Meetup

| Field | Detail |
|-------|--------|
| **ID** | CF-05 |
| **Preconditions** | Meetup was cancelled in Slotted 5 minutes ago. |
| **Action** | Delayed Google webhook arrives with an RSVP change for the now-cancelled meetup. |
| **Expected Result** | System looks up meetup by `google_event_id`, finds `status = 'cancelled'`. Ignores the webhook update gracefully — no error, no state change, no notification. |

---

## 3. Edge Cases

### 3.1 OAuth Token Expired During Webhook Receipt

| Field | Detail |
|-------|--------|
| **ID** | EC-01 |
| **Preconditions** | User A's `google_token_expires_at` is in the past. Webhook arrives for User A. |
| **Action** | Server receives webhook push notification. Attempts to call `events.list` with sync token but gets 401 from Google. |
| **Expected Result** | Server uses `google_refresh_token` to get a new access token. Updates `google_access_token` and `google_token_expires_at` in DB. Retries the `events.list` call. If refresh also fails (token revoked), marks user's calendar as disconnected and creates a notification: "Please reconnect your Google Calendar." |
| **Edge variant** | Refresh token itself is revoked (user removed app access in Google account settings). Must handle gracefully — no crash, user gets prompted to re-auth. |

### 3.2 Google Calendar Webhook Delivery Failure / Retry

| Field | Detail |
|-------|--------|
| **ID** | EC-02 |
| **Preconditions** | Watch channel is active. Google attempts to deliver webhook. |
| **Action** | Slotted's endpoint is temporarily down (deploy, crash). Google retries with exponential backoff. |
| **Expected Result** | Endpoint must be idempotent — processing the same webhook notification multiple times must not create duplicate RSVP changes or duplicate notifications. The `calendar_sync_token` approach handles this naturally (incremental sync returns only unprocessed changes). Server should return 200 quickly (within 10 seconds) to avoid Google marking the channel as unhealthy. |

### 3.3 Watch Channel Expiration and Renewal

| Field | Detail |
|-------|--------|
| **ID** | EC-03 |
| **Preconditions** | User A's `calendar_watch_expiry` is approaching (within 24 hours) or has passed. |
| **Action** | Scheduled function runs to check for expiring channels. |
| **Expected Result** | Function calls `calendar.events.watch()` to create a new channel. Updates `calendar_watch_channel`, `calendar_watch_resource_id`, and `calendar_watch_expiry` in DB. Old channel can be explicitly stopped via `calendar.channels.stop()`. If renewal fails, creates a notification for the user and retries on next scheduled run. |
| **Critical:** | Gap between old channel expiry and new channel creation must trigger a catch-up sync (full incremental sync using `calendar_sync_token`) to ensure no events were missed. |

### 3.4 User Disconnects Google Calendar While Meetups Exist

| Field | Detail |
|-------|--------|
| **ID** | EC-04 |
| **Preconditions** | User A has 3 confirmed meetups with `google_event_id` set. |
| **Action** | User A goes to Settings → Disconnect Google Calendar. |
| **Expected Result** | Watch channel is stopped (`channels.stop()`). `calendar_watch_channel`, `calendar_watch_resource_id`, `calendar_sync_token` are cleared. OAuth tokens are cleared. Existing meetups remain unchanged — they're Slotted data, not calendar data. `google_event_id` values on participant rows should be set to NULL (events may no longer exist). Future webhooks for this user are ignored (no matching channel). User can still RSVP via Slotted directly. |
| **Principle** | Disconnecting calendar should never silently cancel or modify meetups. |

### 3.5 Recurring Event Modifications (Single Instance vs. Series)

| Field | Detail |
|-------|--------|
| **ID** | EC-05 |
| **Preconditions** | Future: if Slotted supports recurring meetups. A Slotted recurring meetup creates a Google recurring event. |
| **Action** | User modifies a single instance of the recurring Google event (e.g., moves "this Thursday" but keeps future Thursdays). |
| **Expected Result** | Google creates an exception event (new `eventId` based on original + instance timestamp). System must match the exception back to the correct Slotted meetup instance. Only that single occurrence should be affected — not the entire recurring series. |
| **Note:** | This is a V2+ concern (recurring commitments feature §7 in backlog). Including it here for completeness. The `google_event_id` format for recurring exceptions is `{baseEventId}_{instanceTimestamp}` — the matching logic must account for this. |

### 3.6 Multiple Calendars — Which Calendar Does the Webhook Come From?

| Field | Detail |
|-------|--------|
| **ID** | EC-06 |
| **Preconditions** | User A has 3 Google calendars selected in `user_calendars` (personal, work, shared). Slotted auto-added the meetup event to their primary calendar. |
| **Action** | User A moves the event from their primary calendar to their work calendar in Google. Webhook fires. |
| **Expected Result** | The event gets a new `eventId` on the new calendar. The old event is deleted from the original calendar. Sync must detect this as a move, not a delete+create. If the system can't detect the move, it should treat it as a deletion (decline) on the old calendar — but NOT create a duplicate meetup from the "new" event on the work calendar. |
| **Critical:** | Watch channels are per-calendar. If only the primary calendar has a watch channel, moves to other calendars may be invisible. Architecture decision needed: watch all selected calendars, or only the calendar where Slotted creates events? |

### 3.7 User Has No Upcoming Meetups But Has Active Watch Channel

| Field | Detail |
|-------|--------|
| **ID** | EC-07 |
| **Preconditions** | User A connected calendar, has active watch channel, but all meetups are completed or cancelled. |
| **Action** | User modifies random personal events on their Google Calendar. Webhook fires. |
| **Expected Result** | Server receives webhook, does incremental sync, finds changed events, but none match any `google_event_id` in `meetup_participants`. Server processes the sync (to update `calendar_sync_token`) but takes no action on meetups. No errors, no wasted notifications. This is a hot-path performance concern — most webhook fires will be for non-Slotted events. |

### 3.8 Webhook Received for Unknown Channel ID

| Field | Detail |
|-------|--------|
| **ID** | EC-08 |
| **Preconditions** | Server receives a `POST /calendar/webhook` with a `X-Goog-Channel-ID` that doesn't match any user's `calendar_watch_channel`. |
| **Action** | Could be a stale channel from a previous deployment, a user who disconnected, or a replay attack. |
| **Expected Result** | Return 200 (to stop Google from retrying) but take no action. Log the unknown channel ID at `warn` level (without PII). Do NOT return 4xx — Google would retry and eventually deactivate the endpoint. |

### 3.9 Google API Quota Exceeded During Sync

| Field | Detail |
|-------|--------|
| **ID** | EC-09 |
| **Preconditions** | Many users' webhooks fire simultaneously (e.g., DST change triggers mass calendar updates). |
| **Action** | Server attempts `events.list` calls but Google returns 429 (rate limit exceeded). |
| **Expected Result** | Server should queue the sync for retry with exponential backoff. The `calendar_sync_token` ensures the retry will pick up right where it left off. Do NOT drop the sync silently. User should not see an error — the sync just happens slightly later. |

### 3.10 Stale Sync Token (Google Returns 410 Gone)

| Field | Detail |
|-------|--------|
| **ID** | EC-10 |
| **Preconditions** | User hasn't synced in a long time. `calendar_sync_token` is stale. |
| **Action** | Server calls `events.list` with the sync token. Google returns 410 Gone. |
| **Expected Result** | Server clears `calendar_sync_token` and performs a full sync (no sync token = full event list). Matches all returned events against `meetup_participants.google_event_id`. Updates any changed RSVPs. Stores the new sync token for future incremental syncs. |

---

## 4. Privacy Invariants

### 4.1 Two-Way Sync Must NOT Expose Other Users' Calendar Details

| Field | Detail |
|-------|--------|
| **ID** | PV-01 |
| **Preconditions** | User A and User B have a confirmed meetup. Webhook fires for User A's calendar. |
| **Test** | When server fetches User A's events to process the webhook, it must NOT store, log, or expose any event details beyond what's needed for matching (`eventId`, `start`, `end`, `attendees[].responseStatus`). Event titles, descriptions, locations of OTHER events on User A's calendar must never be persisted or returned in any API response. |
| **Validation** | Inspect the webhook handler code: it should only read `eventId`, `start`/`end`, `status`, and `attendees` from the Google API response. Any field whitelist approach is safer than a blacklist. |
| **Principle** | Privacy-first — calendar details never exposed. |

### 4.2 Webhook Payloads Must NOT Be Logged With PII

| Field | Detail |
|-------|--------|
| **ID** | PV-02 |
| **Preconditions** | `POST /calendar/webhook` receives a request from Google. |
| **Test** | Application logs for the webhook handler must NOT include: user email, event titles, event descriptions, attendee emails, or full request bodies. Acceptable to log: channel ID, resource ID, sync token (opaque strings), user UUID, timestamp, event count processed. |
| **Validation** | Grep all `console.log`, `console.error`, `logger.*` calls in the webhook handler. Verify no PII fields are interpolated. Consider structured logging with an explicit allowlist of fields. |
| **Principle** | Privacy-first. |

### 4.3 Sync State Must Respect RLS Policies

| Field | Detail |
|-------|--------|
| **ID** | PV-03 |
| **Preconditions** | RLS is enabled on all tables. Backend uses `service_role` key (bypasses RLS). |
| **Test** | Even though the backend bypasses RLS, all queries in the webhook handler must be scoped to the specific user whose webhook fired. The handler must NOT perform cross-user queries (e.g., "find all meetup_participants for this event" without filtering by the webhook user). |
| **Validation** | Every Supabase query in the handler should include `WHERE user_id = <webhookUserId>` or equivalent scoping. |
| **Principle** | Defense in depth — even with service_role, code should be least-privilege. |

### 4.4 Webhook Endpoint Must Verify Google Origin

| Field | Detail |
|-------|--------|
| **ID** | PV-04 |
| **Preconditions** | `POST /calendar/webhook` is a public endpoint (Google must reach it). |
| **Test** | Endpoint must validate the `X-Goog-Channel-ID` and `X-Goog-Resource-ID` headers against stored values in the `users` table before processing. Requests with unknown or mismatched headers should be accepted (200) but not processed. |
| **Validation** | Send a crafted POST to `/calendar/webhook` with fake headers. Verify no data changes occur. Verify no sensitive data is returned in the response body (should be empty or minimal). |
| **Principle** | Security — prevent spoofed webhooks from triggering state changes. |

### 4.5 No Cross-User Calendar Leakage via Notifications

| Field | Detail |
|-------|--------|
| **ID** | PV-05 |
| **Preconditions** | User A changes RSVP via Google Calendar. Notification is sent to User B. |
| **Test** | The notification body must say something like "Alex updated their RSVP for Saturday hangout" — it must NOT include any details about WHY they changed (e.g., "Alex has a work meeting" or "Alex's calendar shows a conflict"). The notification must not reference any event from User A's calendar other than the Slotted meetup. |
| **Principle** | Privacy-first — never expose calendar details. AI uses data internally, never displays it. |

---

## 5. Performance Scenarios

### 5.1 Bulk Sync After Reconnection

| Field | Detail |
|-------|--------|
| **ID** | PF-01 |
| **Preconditions** | User A disconnected calendar for 2 weeks, had 8 meetups with Google events during that period. Some were accepted, some declined, some times changed in Google. User A reconnects calendar. |
| **Action** | On reconnect, system creates a new watch channel and performs a full sync (no sync token). |
| **Expected Result** | All 8 meetup participant records are reconciled: RSVPs updated, time drifts flagged. Process completes in < 30 seconds. No duplicate notifications — if a meetup was cancelled in Slotted during the disconnection, stale Google changes are ignored. Batch notifications: "8 meetups synced — 2 RSVP changes detected" rather than 8 individual notifications. |

### 5.2 Webhook Storm Handling (Many Rapid Changes)

| Field | Detail |
|-------|--------|
| **ID** | PF-02 |
| **Preconditions** | DST transition, Google Calendar bulk update, or user doing rapid edits. Multiple webhook notifications arrive within seconds. |
| **Action** | 20 webhook notifications arrive for the same user within 5 seconds. |
| **Expected Result** | Server should debounce or coalesce: process the first webhook, then when subsequent ones arrive, either (a) skip if a sync is already in-progress for that user, or (b) queue one follow-up sync after the current one completes. The `calendar_sync_token` ensures no changes are missed even if intermediate webhooks are skipped. Must NOT spawn 20 parallel `events.list` calls for the same user. |
| **Target** | < 5 seconds total processing time for a storm of 20 webhooks per user. |

### 5.3 Non-Slotted Event Changes (Hot Path)

| Field | Detail |
|-------|--------|
| **ID** | PF-03 |
| **Preconditions** | User has 200 events on their Google Calendar but only 2 Slotted meetups. |
| **Action** | User modifies a non-Slotted event. Webhook fires. Server does incremental sync. |
| **Expected Result** | Server fetches changed events (usually 1-3 via sync token), checks each against `meetup_participants.google_event_id`. Finds no match. Updates `calendar_sync_token` and returns. Total processing: < 500ms. This is the most common webhook scenario — it must be fast. |

### 5.4 Many Users' Channels Expire Simultaneously

| Field | Detail |
|-------|--------|
| **ID** | PF-04 |
| **Preconditions** | 500 users all had watch channels created around the same time (e.g., bulk onboarding). Channels expire after ~7 days. |
| **Action** | Scheduled renewal function runs. Finds 500 channels expiring within 24 hours. |
| **Expected Result** | Function renews channels in batches (e.g., 50 at a time) with delays to respect Google API quotas. Uses exponential backoff on 429 errors. All channels renewed within the scheduled function's execution window. Failed renewals are retried on the next run. |

---

## 6. Apple Calendar (CalDAV) Scenarios

> Apple Calendar uses polling, not webhooks. These scenarios validate the polling-based sync path.

### 6.1 Apple RSVP Change Detected via Polling

| Field | Detail |
|-------|--------|
| **ID** | AP-01 |
| **Preconditions** | User A has Apple Calendar connected. Slotted meetup has a CalDAV event with UID `slotted-{meetupId}-{userId}@slotted-ai.web.app`. `apple_last_sync_at` set to 10 minutes ago. |
| **Action** | Scheduled function polls CalDAV with REPORT since last sync. Finds the event's `PARTSTAT` changed from `ACCEPTED` to `DECLINED`. |
| **Expected Result** | `meetup_participants.rsvp` → `'declined'`. `apple_last_sync_at` updated. Same notification flow as Google webhook path. |

### 6.2 Apple Event Deleted

| Field | Detail |
|-------|--------|
| **ID** | AP-02 |
| **Preconditions** | Same as AP-01. |
| **Action** | Poll finds the event UID is absent (deleted by user in Apple Calendar). |
| **Expected Result** | Treat as decline. Same behavior as HP-04. |

### 6.3 Apple CalDAV Authentication Failure

| Field | Detail |
|-------|--------|
| **ID** | AP-03 |
| **Preconditions** | User A's app-specific password has been revoked in iCloud settings. |
| **Action** | Scheduled poll attempts CalDAV REPORT. Gets 401. |
| **Expected Result** | Mark Apple Calendar as disconnected (`apple_calendar_connected = FALSE`). Create notification: "Please reconnect your Apple Calendar." Do not retry with invalid credentials (avoids account lockout). |

---

## 7. Notification Language Audit

> All notifications generated by the two-way sync system must comply with Slotted's soft social dynamics principle.

| Scenario | ❌ Forbidden Language | ✅ Acceptable Language |
|----------|----------------------|----------------------|
| User declines via Google Calendar | "Alex declined your meetup" / "Alex rejected the plan" | "Alex can't make it this time" / "Alex updated their RSVP" |
| User deletes Google Calendar event | "Alex cancelled" / "Event was deleted" | "Alex won't be joining this one" / "Alex stepped out of Saturday's plan" |
| User sets RSVP to maybe | "Alex is uncertain" / "Alex hasn't committed" | "Alex might not make it" / "Alex is unsure about this one" |
| Counter-propose triggered by time change | "Alex moved your event" / "Time conflict detected" | "Alex suggested a different time" / "Alex proposed a change" |
| Calendar disconnected | "Calendar access revoked" / "Sync broken" | "Your calendar isn't connected right now — reconnect anytime" |

---

## 8. Test Implementation Notes

### Existing Test Infrastructure
- Tests live in `tests/agents/` using a persona-based agent framework
- Scenarios are TypeScript modules exporting `Scenario` objects
- Agents have methods like `createMeetup()`, `rsvpMeetup()`, `getNotifications()`
- When implementing, a new scenario file `tests/agents/src/scenarios/two-way-sync.ts` should be created

### What Can Be Tested Without Google
- Webhook endpoint validation (fake POST requests with headers)
- Sync token management (mock Google API responses)
- Conflict resolution logic (unit tests for the diffing/matching logic)
- Notification language (check generated notification strings)
- Privacy invariants (ensure handler code doesn't log or expose PII)

### What Requires Google Calendar Integration
- End-to-end RSVP flow (modify event in real Google Calendar → verify Slotted state)
- Watch channel creation and renewal
- Incremental sync with real sync tokens
- These should be integration tests with a dedicated test Google account

### Priority Order for Implementation
1. **PV-01 through PV-05** (privacy invariants) — non-negotiable, test first
2. **HP-01, HP-04, HP-06** (core RSVP mapping) — the primary value of two-way sync
3. **EC-01, EC-02, EC-08** (error resilience) — webhooks will fail; graceful handling is essential
4. **CF-01, CF-05** (conflict resolution) — prevents data corruption
5. **PF-02, PF-03** (performance) — webhooks fire constantly; must be fast
6. **Everything else** — important but lower blast radius

---

## 9. Open Questions for Architecture Review

These need answers from Beard's architecture design before tests can be finalized:

1. **Watch channel scope:** One channel per user (watching primary calendar only) or one per selected calendar in `user_calendars`? Affects EC-06 significantly.
2. **Time drift handling (HP-03):** Does the system auto-revert the user's Google event, trigger a counter-propose flow, or just flag it? Test assertions depend on this decision.
3. **Webhook debouncing strategy (PF-02):** In-memory (per-instance), Redis-based, or Firestore-based dedup? Affects whether we can test it in unit tests or need integration tests.
4. **Notification batching (PF-01):** Does the system batch notifications for bulk sync, or send them individually? Affects notification count assertions.
5. **All-day event policy (CF-04):** Ignore the conversion, revert it, or flag it? No clear spec guidance.
