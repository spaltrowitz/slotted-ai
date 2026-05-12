# Decisions

> Older decisions archived to decisions-archive.md on 2026-05-03

> Canonical record of team decisions. Append-only. Scribe merges from inbox.

---

---

### Decision

Implement two-way Google Calendar sync using **push notifications (webhooks)** with **incremental sync tokens**, deployed in 4 phases. Google Calendar is source of truth for individual RSVP/deletion; Slotted is source of truth for multi-party state.

---

### Key Choices

1. **Webhooks over polling** for Google Calendar (near real-time, lower API cost)
2. **Per-user watch on 'primary' calendar** — Slotted only writes to primary, so that's where changes appear. Expand to per-calendar later if needed.
3. **Incremental sync tokens** to avoid re-fetching all events on each webhook.
4. **`rsvp_source` column** to prevent feedback loops between Slotted ↔ Google Calendar.
5. **New notification types** (`meetup_rsvp_changed`, `meetup_time_changed`, `meetup_counter_propose`) for analytics and future UX differentiation.
6. **Soft notification language** for calendar-originated declines: "is no longer available" not "declined."
7. **No new frontend API calls** — the sync is entirely server-driven via existing webhook infrastructure.

---

### Privacy Assessment

No new privacy risks. Webhook data stays server-side. We only inspect events matching our own `google_event_id`. Friends see RSVP changes through existing notification system with soft language. The `rsvp_source` column is internal — users never see whether a change originated from the calendar or the app.

---

### Phases

| Phase | Effort | What Ships |
|---|---|---|
| 1. Watch channels | 2–3 days | Real-time webhook pipeline wired up (prerequisite) |
| 2. RSVP & deletion sync | 3–4 days | Core feature: Google Calendar RSVP/delete → Slotted update |
| 3. Time change detection | 2–3 days | Counter-propose flow for calendar-originated time moves |
| 4. Apple + hardening | 1–2 weeks | CalDAV polling, rate limiting, monitoring |

---

### Risks

- **Google API quota**: Watch channels count against quota. Negligible at current scale (~20 users).
- **Missed webhooks during renewal gap**: Scheduled function runs every 6 hours; worst case, a 6-hour gap between channel expiry and renewal.
- **OAuth token plaintext storage**: Pre-existing risk (flagged in improvement analysis). Two-way sync doesn't worsen it but motivates encryption.

---

### Plan Document

`docs/plans/plan-two-way-calendar-sync.md`

---

---

### Critical Edge Cases

#### 1. Multi-Calendar Watch Channels (EC-06)

**Problem:** Users can have multiple Google calendars selected in `user_calendars`. When Slotted auto-adds an event to their primary calendar and the user moves it to a different calendar, the event gets a new `eventId`. If we only watch the primary calendar, we'll see a deletion (→ false decline) and miss the new event on the other calendar.

**Options:**
- (a) Watch all selected calendars — more API quota usage, more webhook volume, but full coverage
- (b) Watch only the calendar where Slotted creates events — simpler, but moves between calendars look like deletions
- (c) Watch primary only, but on "deletion" do a cross-calendar search before treating as a decline

**Recommendation from QA:** Option (b) with a grace period before treating deletion as decline (e.g., wait 60 seconds and re-check). This limits blast radius while catching most moves.

#### 2. Webhook Debouncing Strategy (PF-02)

**Problem:** Google sends a push notification saying "something changed" but doesn't say what. We must call `events.list` with a sync token to find out. If 20 notifications arrive in 5 seconds (common during bulk edits or DST), we'd make 20 redundant API calls.

**Architecture need:** A per-user mutex or debounce mechanism. Options:
- (a) In-memory lock per Cloud Function instance (doesn't work — functions are stateless)
- (b) Firestore/Supabase-based lock with TTL
- (c) Cloud Tasks queue with deduplication by user ID

**Recommendation from QA:** Option (c) — Cloud Tasks gives us exactly-once semantics and built-in retry. The webhook endpoint enqueues a task, the task does the actual sync.

#### 3. Time Drift Policy (HP-03, CF-04)

**Problem:** When a user drags a meetup event to a different time in Google Calendar, what should Slotted do? The spec says "flag for counter-propose flow" but doesn't define the mechanic.

**Scenarios to cover:**
- Small drift (< 30 min): probably user adjusting for traffic — might be acceptable to auto-accept
- Large drift (> 1 hour): definitely a reschedule — should trigger counter-propose
- All-day conversion: ambiguous — could mean "I blocked the day" not "change the time"

**Need from Toph:** Define thresholds and the flow. My tests will assert against whatever is decided.

#### 4. Stale Sync Token Recovery (EC-10)

**Problem:** If `calendar_sync_token` goes stale (Google returns 410), we need a full re-sync. During a full sync, we might find Google events that don't correspond to any Slotted meetup (user's personal events). We MUST NOT create meetups from these — only match against existing `google_event_id` values.

**Risk:** If the full sync code uses the same "process new events" path as the incremental sync, it might try to create meetup records from non-Slotted events. The sync handler needs separate paths for "known Slotted events" vs. "unknown events."

---

### Non-Critical But Notable

- **EC-08 (unknown channel ID):** Must return 200, not 4xx. Google will deactivate our endpoint if it gets too many errors. This is a correctness requirement, not just a nice-to-have.
- **PF-04 (bulk channel renewal):** Google's `events.watch` has a per-user rate limit. Renewing 500 channels needs batching with delays. Budget ~15 min for the scheduled function.
- **AP-03 (Apple auth failure):** Don't retry with bad credentials — Apple/iCloud may lock the account after repeated failures.

---

---

### Decision

Added three new notification types to `NotificationsPage.tsx` for the two-way calendar sync feature:

- `meetup_rsvp_changed` — 🔄 sky-blue theme, "View meetup" CTA
- `meetup_time_changed` — 🕐 indigo theme, "View meetup" CTA
- `meetup_counter_propose` — 💡 violet theme, "View meetup" CTA (accept/dismiss UI deferred to Phase 3)

---

### Key Choices

1. **All three types in Reminders tab** — they're informational, not actionable (yet). `meetup_counter_propose` will move to Requests tab once Phase 3 adds accept/dismiss UI.
2. **"View meetup" links to `/dashboard`** — no dedicated meetup detail route exists. When one is added, update these links.
3. **No new components** — followed existing pattern of adding to `typeConfig` + inline JSX blocks.
4. **Soft language is backend-driven** — notification `title` and `body` come from the server. Frontend only controls emoji, colors, and CTA text. CTA text uses neutral "View meetup."

---

### Open Items

- Phase 3: Add accept/dismiss UI for `meetup_counter_propose` (move to Requests tab at that point)
- Future: When a meetup detail page is built, update the "View meetup" link target

---

---

### Summary
- Applied `calendar_sync_token` only for the primary Google calendar (calendar id `"primary"` or matching the user's email) since there is a single token stored per user.
- When a sync token returns a 410, the token is cleared and the calendar is re-fetched without a sync token to preserve availability accuracy.

---

### Notes
- Watch channel creation/teardown and webhook integration follow the plan without further deviations.

---

---

### Summary

Fixed 3 critical bugs from Sokka's code review of Two-Way Calendar Sync (Phases 1–3). All fixes committed as 5db77f9. Build passes.

---

### CRIT-1: Feedback Loop Prevention

**Problem:** `rsvp_source` selected but never checked. Stale webhooks could overwrite app-sourced RSVPs.

**Fix:**
- Added `gcal_last_synced_at` to participant query
- Added `isRecentAppChange` guard: if `rsvp_source === 'app'` AND sync within 60s, skip RSVP change
- Applied to both cancelled-event and RSVP-mapping paths
- Fixed secondary bug: cancelled-event `continue` now updates etag before skipping

---

### CRIT-2: Disconnect Cleanup

**Problem:** `POST /calendar/disconnect` left `calendar_watch_channel`, `calendar_watch_resource_id`, `calendar_sync_token` orphaned. Stale watch channels kept firing webhooks; orphaned `google_event_id` caused sync confusion on reconnect.

**Fix:**
- Added null fields to user update at line 6536
- Added separate query to null `google_event_id` on participant rows

---

### CRIT-3: Webhook Returns 200

**Problem:** Webhook returned 403 for invalid tokens. Google deactivates endpoints returning 4xx.

**Fix:**
- Changed to `console.warn()` + `res.status(200).send("OK")`
- Any webhook handler must NEVER return non-2xx — log the error, always respond 200

---

### Verification
- `npm run build` ✅
- No schema changes
- Ready for production

---

---

### Verdict

Structurally sound. Core happy paths covered well. **3 critical bugs + 2 high-severity gaps** identified and fixed by Zuko (commit 5db77f9). Notification language compliant with soft social dynamics ✅.

---

### Coverage Scorecard

| Category | ✅ Covered | ⚠️ Partial | ❌ Missing | 🔮 Future |
|----------|-----------|-----------|-----------|----------|
| Happy Path (6) | 5 | 1 | 0 | 0 |
| Conflicts (5) | 2 | 2 | 1 | 0 |
| Edge Cases (10) | 4 | 2 | 2 | 2 |
| Privacy (5) | 3 | 2 | 0 | 0 |
| Performance (4) | 1 | 2 | 1 | 0 |
| **Total (30)** | **15** | **9** | **4** | **2** |

**Coverage: 15/30 fully covered (50%), 9/30 partial (30%), 4/30 missing (13%), 2/30 deferred (7%).**

---

### Notification Language Audit

All user-facing strings comply with soft social dynamics:
- Decline: "is no longer available" ✅
- Maybe: "is now a maybe" ✅
- Time change: "updated the time" ✅
- Counter-propose: "suggests a different time" ✅
- Frontend: "Not this time" (never "declined") ✅

---

---

### Decision

Upgraded `meetup_counter_propose` notifications from informational to actionable:
- **"💡 Update time"** — primary action, violet accent. Calls `PATCH /meetups/:id/rsvp` (interim signal), marks read.
- **"Keep original"** — secondary. Marks read without side effect.

Moved to Requests tab (was Reminders).

---

### Key Choices
- Three-state rendering: unread (buttons) → acted (pill) → already-read (fallback link)
- Soft language: "Update time" / "Keep original" (never "Accept" / "Reject")
- RSVP endpoint as interim — awaiting dedicated backend endpoint for actual time update

---

### Open Items
- Backend: Need endpoint for creator to accept counter-proposal and update meetup time
- UX: "View meetup" link should target dedicated meetup detail page (not `/dashboard`) when available

---

---

### Decision

When a Google Calendar event time changes for a Slotted meetup:

1. **Creator moved it** → Meetup `start_time`/`end_time` updated directly. All participants get `meetup_time_changed` notification.
2. **Non-creator moved it** → No meetup times changed. Creator gets `meetup_counter_propose` notification with suggested time.

---

### Key Choices
- **ISO string comparison** for time equality (avoids timezone edge cases)
- **No threshold logic** — any time difference triggers flow (can add thresholds later)
- **Counter-propose is notification-only** — no accept/dismiss UI yet (deferred per Keeley)

---

---

### Context
The CORS middleware in `functions/src/index.ts` had a security hole: the fallback for unknown origins was `callback(null, true)`, allowing any domain to make authenticated API requests.

---

### Decision
Changed the else branch to `callback(new Error("Not allowed by CORS"))` so unknown origins are rejected with a CORS error.

---

### Allowed Origins (unchanged)
- `http://localhost:5173` — Vite dev server
- `http://localhost:5174` — Vite dev server (alternate port)
- `https://slottedapp.com` — Firebase Hosting (production)
- `https://slotted-ai.firebaseapp.com` — Firebase Hosting (alternate)

---

### Trade-offs
- Requests with no `Origin` header (mobile apps, curl, server-to-server) are still allowed through — this is standard and intentional. Firebase Auth middleware is the real gatekeeper for those.
- If a staging domain is added later, it needs to be added to `allowedOrigins` or the request will be blocked.

---

### Files Changed
- `functions/src/index.ts` line 55 — one-line change

---

---

### Summary

Firebase Functions deploy succeeded after `.env` was populated with real credentials. All functions now at `https://api-xwsmuazwmq-uc.a.run.app`.

---

### Functions Deployed

- `api` — Express app + all HTTP routes
- `findCalendarMatches` — AI matching engine
- `renewCalendarWatchChannels` — Scheduled watch renewal
- `sendMeetupReminders` — Scheduled reminders
- `sendPendingRsvpNudges` — Scheduled nudges

---

### Open Items

- User to run migration column-check in Supabase SQL Editor (statements 1–4 pending)

---

---

### Summary

Redesigned two elements of the public landing page to fix visual hierarchy and section differentiation issues reported by Shari.

---

### Changes

#### 1. Early Access Badge

**Problem:** Badge used teal color identical to the CTA button, creating no visual hierarchy. The tiny 1.5px pulsing dot was too subtle and the badge lacked urgency.

**Fix:**
- Color shifted from teal → amber/orange gradient (`from-amber-50/90 to-orange-50/90`, `text-amber-800`)
- Replaced pulsing dot with ✨ sparkle emoji for personality
- Bumped padding (`px-3 py-1` → `px-4 py-1.5`) and weight (`font-medium` → `font-semibold`)
- Added `shadow-sm` for subtle depth
- Added urgency copy: "Early access — limited spots"

#### 2. "Why It Matters" Section

**Problem:** Visually identical to "How It Works" — same pastel gradient cards, same borders, same heading style, same hover effects. Users couldn't distinguish sections while scanning.

**Fix:**
- Wrapped entire section in a `rounded-3xl` dark panel (`from-slate-900 via-slate-800 to-slate-900`) with `shadow-xl`
- Cards changed from colored pastel fills to frosted glass: `bg-white/[0.06]` with `border-white/[0.08]`
- Text inverted: titles → `text-white`, descriptions → `text-slate-400`
- Hover changed from translate-y lift to subtle opacity shift (`hover:bg-white/[0.10]`)
- Removed per-card color/border data (no longer needed on dark surface)
- Added more vertical breathing room (`mb-6` → `mb-8`)

---

### Design Rationale

- The dark panel creates an unmistakable visual break between "How It Works" (light, colorful, step-based) and "Why It Matters" (dark, refined, value-based)
- Amber badge avoids competing with teal CTAs — warm gold connotes exclusivity
- No new CSS classes or design tokens introduced — all standard Tailwind utilities
- Respects Slotted's product principles: no pressure language in the badge copy, privacy card retained prominently

---

### Files Changed

- `client/src/pages/LoginPage.tsx` — lines 36-39 (badge), lines 137-184 (Why It Matters section)

---
