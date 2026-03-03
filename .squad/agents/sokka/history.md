# Sokka — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** React 19 + TS + Vite (client/), Firebase Functions + Express (functions/), Supabase PostgreSQL
- **Test location:** tests/

## Learnings

<!-- Append learnings below -->

### Phase 4 Priority Recommendations (2026-03-03)

**HIGH-1 (Creator time change override):** Medium-high urgency. Creator dragging a group meetup in GCal silently changes everyone's time with no consent. Fix: route group meetups (3+ participants) through counter-propose; allow direct update only for 1:1s. ~2 hours. Fix before Phase 4.

**HIGH-2 (410 stale token no retry):** Low-medium urgency. Webhook handler clears stale token but doesn't retry — one-webhook delay before catch-up. Self-healing but adds invisible latency. ~30 min fix. Bundle with HIGH-1.

**Phase 4 ordering:** Integration tests FIRST (zero tests exist — every past bug was found by code review), then structured logging (no visibility into sync behavior), then rate limiting (low risk at ~20 users), then Apple CalDAV LAST (defer — no user demand, high complexity, Google sync not hardened yet).

**Key insight:** The `tests/` directory has no actual test files — only agent scaffolding. This means there is no regression safety net. Every code change to the 8000+ line `index.ts` is flying blind. The test harness is the single highest-leverage thing to build next.

### Zuko's CRIT Fixes Applied (2026-03-03, commit 5db77f9)

**All 3 critical bugs from this review are now fixed by Zuko. Ready for production deployment.**

#### CRIT-1 Fix: Feedback Loop Prevention
- **Location:** `functions/src/index.ts` ~lines 7607–7640
- **Change:** Added `isRecentAppChange` guard: if `rsvp_source === 'app'` AND `gcal_last_synced_at` within 60s, skip RSVP change
- **Applied to:** Both cancelled-event and RSVP-mapping paths
- **Secondary:** Cancelled-event path now explicitly updates etag before skipping

#### CRIT-2 Fix: Disconnect Cleanup
- **Location:** `functions/src/index.ts` ~lines 6536–6555
- **Change:** Added `calendar_watch_channel: null, calendar_watch_resource_id: null, calendar_sync_token: null` to user update
- **Additional:** Separate query nulls `google_event_id` on participant rows

#### CRIT-3 Fix: Webhook Returns 200
- **Location:** `functions/src/index.ts` ~line 7800
- **Change:** `console.warn()` + `res.status(200).send("OK")` (was: 403)
- **Reason:** Google deactivates endpoints returning 4xx

**Review Summary:** 15/30 test scenarios fully covered, 9/30 partial, 4/30 missing (3 were the criticals). Notification language audit: ✅ Compliant.

---

### Two-Way Sync Code Review — Phases 1-3 (2026-03-03)

**Reviewed implementation in `functions/src/index.ts` lines 6440-8000 and `client/src/pages/NotificationsPage.tsx` against test scenarios in `docs/plans/test-scenarios-two-way-sync.md`.**

**Key findings:**
- Core RSVP sync (HP-01, HP-04, HP-06) is correctly implemented with `processCalendarChanges` → `updateRsvpFromCalendar` pipeline
- Phase 3 time detection works but has a critical bug: creator time changes silently update meetup for all participants without consent check
- Feedback loop prevention via `rsvp_source` column is INCOMPLETE — code selects it but never checks it before overwriting app-sourced RSVPs
- Disconnect endpoint (`POST /calendar/disconnect`) does NOT clear `calendar_watch_channel`, `calendar_watch_resource_id`, `calendar_sync_token`, or `google_event_id` on participant rows
- Webhook endpoint returns 403 for unknown channels instead of 200 — will cause Google to deactivate the endpoint (EC-08 violation)
- 410 stale sync token handling clears the token but does NOT retry with a full sync in the same request
- No webhook debouncing — 20 rapid webhooks will fire 20 parallel `events.list` calls
- Notification language is compliant (soft social dynamics) ✅
- `toLocaleString()` on server-side (line 7674) will render in server's locale, not user's — minor but sloppy

**Verdict: CONDITIONAL APPROVE** — 3 critical issues must be fixed before shipping (feedback loop, disconnect teardown, webhook 403→200).

---

### Two-Way Calendar Sync Test Planning (2025-02-27)

**Schema details relevant to testing:**
- `meetup_participants.google_event_id` links a participant's calendar event to their Slotted record — this is the primary join key for two-way sync matching
- `users.calendar_sync_token` enables incremental sync (Google returns only changes since last sync) — critical for idempotency and performance
- `users.calendar_watch_channel` + `calendar_watch_resource_id` are needed to validate and stop webhook channels
- `meetup_participants.calendar_source` tracks whether event was added to Google or Apple calendar
- Apple CalDAV uses deterministic UIDs: `slotted-{meetupId}-{userId}@slotted-ai.web.app`
- RLS is enabled on all tables; backend uses `service_role` key (bypasses RLS)

**Key test patterns for webhook-based sync:**
- Always return HTTP 200 from webhook endpoint, even for unknown/invalid channels — Google deactivates endpoints that return errors
- Webhook notifications are "something changed" signals, not payloads — must call `events.list` with sync token to get actual changes
- Sync token going stale (Google 410 Gone) requires full re-sync fallback
- Most webhook fires will be for non-Slotted events — the "no match found" path must be extremely fast (< 500ms)

**Critical edge cases discovered:**
- Multi-calendar moves: user moving event between calendars generates a delete + create with NEW eventId — looks like a false decline
- Webhook storms: stateless Cloud Functions can't do in-memory debouncing — need queue-based (Cloud Tasks) or DB-based dedup
- Time drift vs. timezone display: must compare absolute UTC timestamps, never display-local times
- OAuth token refresh during webhook: must handle expired AND revoked tokens differently (retry vs. disconnect)
- Stale sync full re-sync must NOT create meetups from non-Slotted events found during full event list

**Notification language rules (soft social dynamics):**
- Never say "declined," "rejected," "cancelled" — use "can't make it," "stepped out," "updated their RSVP"
- Never expose WHY someone changed RSVP (no calendar detail leakage in notifications)

**Files created:**
- `docs/plans/test-scenarios-two-way-sync.md` — 30 test scenarios across 9 categories
- `.squad/decisions/inbox/sokka-sync-edge-cases.md` — 4 critical architecture questions for Toph

---

## Cross-Agent References (2026-02-27)

### Katara's Empty States & Invite Route (QW-1, QW-6)
Katara shipped empty state strategy and InvitePage. From QA perspective, ensure notifications respect soft language (no "declined," use "can't make it"). InvitePage inviter lookup (`GET /users/invite/:code`) backend is already live; verify public route accessibility in tests.

### Toph's Two-Way Sync Architecture
Toph designed webhook + incremental sync for calendar changes. Test scenarios in this file assume decisions on 4 critical edge cases (multi-calendar moves, webhook debouncing, time drift policy, stale token recovery). Implementation is blocked until those decisions are made.
