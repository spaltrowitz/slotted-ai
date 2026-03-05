# Sokka — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** React 19 + TS + Vite (client/), Firebase Functions + Express (functions/), Supabase PostgreSQL
- **Test location:** tests/

## Learnings

<!-- Append learnings below -->

### E2E Test Fix Sprint — 53→75 passing (2026-03-05)

**Root causes of 16 originally-failing tests:**

1. **Client–backend payload key mismatch (caused ~10 failures):**
   - `acceptFriendship` sent `{ status: "accepted" }` but backend expects `{ action: "accept" }`. Same for `declineFriendship`.
   - `createMeetup` sent snake_case keys (`friend_ids`, `start_time`, `end_time`) but backend expects camelCase (`friendIds`, `startTime`, `endTime`).
   - `createGroup` sent `member_ids` but backend expects `memberIds`.
   - `saveEvent` test missing required `id` field on event object.

2. **getFriends() response mapping mismatch (caused ~4 failures):**
   - Backend returns `{ friendshipId, status, friend: {...} }` per item, but client/tests assumed `{ id, user_a_id, user_b_id, status }`.
   - `pendingFriendship.id` was always `undefined` → accept went to `/friends/undefined` → 500 error.
   - Fixed: `getFriends()` now maps `friendshipId` → `id`. Updated notification-dedup to use `friend.id` instead of `user_a_id/user_b_id`.

3. **Notification timing (caused ~3 failures):**
   - Tests checked notifications immediately after actions. Added `waitFor()` polling helper (5 attempts × 1s) for notification checks in friends, meetups, and notification-dedup scenarios.

4. **Stale-state assertion (1 failure):**
   - Duplicate notification check counted ALL `friend_accepted` globally instead of per-sender. Planner legitimately had 2 from 2 different friends. Fixed to scope check to the specific sender (Spontaneous).

**Remaining 5 failures are backend issues, NOT test bugs:**
- `manual_busy_blocks` table doesn't exist in DB → busy-blocks (3) + availability seed (1) → needs migration
- Group delete returns 200 for non-creators → authorization gap in `DELETE /groups/:id`

**Infrastructure added:**
- `waitFor<T>(fn, predicate, maxAttempts, delayMs)` polling helper in `scenario.ts`

**Key file paths:**
- Test client: `tests/agents/src/client.ts`
- Scenario framework + helpers: `tests/agents/src/scenario.ts`
- All 10 scenarios: `tests/agents/src/scenarios/`
- Test runner: `tests/agents/src/runner.ts`

**Critical pattern: always match client payload keys to backend `req.body` destructuring.** The backend uses camelCase for meetups/groups (`friendIds`, `startTime`, `memberIds`) and snake_case for busy-blocks (`start_time`, `end_time`). No consistency — must read each endpoint.

### Notification Dedup Test Suite (2026-07-14)

**Created:** `tests/agents/src/scenarios/notification-dedup.ts` — 6 tests covering the cascading dedup fix in `createNotification`.

**Key patterns discovered:**
- `SlottedClient` was missing `connectReferral()` and `acceptFriendshipAction()` — added both. The existing `acceptFriendship()` sends `{ status: "accepted" }` but the endpoint expects `{ action: "accept" }`. New method sends the correct payload.
- The `createNotification` dedup logic is cascading (not if/else): checks `relatedUserId` first (1hr window), then `relatedId` (5min), then `title` (10min). DB unique index is the final safety net (catches 23505 errors silently).
- Three code paths create `friend_accepted` notifications: POST /users/me (relatedUserId only, no relatedId), POST /friends/connect-referral (both), PATCH /friends/:friendshipId with action=accept (both). The primary dedup on relatedUserId is what prevents duplicates across paths 1 and 2 during signup.
- Test scenario priority 35 — runs after notifications (30) but before errors (70).

**Files modified:**
- `tests/agents/src/scenarios/notification-dedup.ts` (new)
- `tests/agents/src/client.ts` (added `connectReferral`, `acceptFriendshipAction`)
- `tests/agents/src/runner.ts` (registered new scenario)
- `tests/agents/package.json` (added npm script)

### Notification Dedup Hardening & E2E Tests (2026-03-04)

**Session:** Zuko reviewed & hardened migration; Sokka created comprehensive E2E test suite.

#### Review & Hardening (Zuko)
- Found critical issue: unique index on both `friend_accepted` AND `friend_request` types blocked legitimate group notifications (type overloading)
- Fixed: narrowed to `friend_request` only, scoped cleanup DELETE to title-matched patterns
- Decision merged: "Narrow Notification Dedup Index to friend_request Only"

#### E2E Test Suite (Sokka)
- 6 tests in `tests/agents/src/scenarios/notification-dedup.ts`
- Tests: single connect, rapid reconnect dedup, type coexistence, user pair independence, global invariants
- Added `connectReferral()` and `acceptFriendshipAction()` SDK methods
- All tests compile clean; require live backend to execute
- Run: `npm run scenario:notification-dedup` from `tests/agents/`
- Decision merged: "Notification Dedup Test Coverage"

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

### E2E Test Infrastructure Sprint — Polling Helper + Client Normalizations (2026-03-05)

**Summary:** Fixed 22 E2E test failures (53→75 passing, 94% success rate). Added polling infrastructure and normalized test client payloads to match backend expectations. Remaining 5 failures are backend issues (missing migration table, authorization gap).

**Deliverables:**

1. **Polling Infrastructure** (`tests/agents/src/scenario.ts`)
   - `waitFor<T>(fn, predicate, maxAttempts, delayMs)` helper for async assertion polling
   - Default: 5 attempts, 1s delay (configurable)
   - Handles notification arrival timing and backend-side async operations

2. **Test Client Fixes** (`tests/agents/src/client.ts`)
   - `acceptFriendship` / `declineFriendship`: Send `{ action: "accept" }` / `{ action: "decline" }` (was `{ status: "accepted" }`)
   - `createMeetup`: Send camelCase (`friendIds`, `startTime`, `endTime`)
   - `createGroup`: Send `memberIds` (camelCase)
   - `getFriends()`: Map `friendshipId` → `id` for response normalization

3. **Scenario Fixes** (6 scenarios updated)
   - **friends.ts**: Polling for notifications; scoped duplicate check to per-sender (was counting all globally)
   - **meetups.ts**: Polling for `meetup_request` and `meetup_confirmed` notifications
   - **notification-dedup.ts**: Use `friend.id` instead of raw `user_a_id/user_b_id`; added polling
   - **calendar-events.ts**: Added required `id` field to test event; polling for saved events
   - (Plus 2 others with timing fixes)

**Remaining 5 Failures (Backend Issues):**
- 3 failures: `manual_busy_blocks` table missing — Zuko's migration pending Supabase application
- 1 failure: Availability seed depending on table
- 1 failure: Group delete authorization gap in `DELETE /groups/:id` (returns 200 for non-creators)

**Key Insight:** Backend payload key inconsistency is a footgun. Endpoints use camelCase for some (meetups, groups) and snake_case for others (busy-blocks). No convention — inspect each endpoint's `req.body` destructuring to know what to send.

**Cross-Agent Synergy:** Zuko's backend normalizations (accepting both naming styles) pair with these test client fixes. Both delivery in parallel removes testing friction entirely.

