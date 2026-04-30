# Sokka — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** React 19 + TS + Vite (client/), Firebase Functions + Express (functions/), Supabase PostgreSQL
- **Test location:** tests/

## Learnings

<!-- Append learnings below -->

### 2026-04-30: Full Security, Vulnerability & Quality Audit (All Agents)

**Findings:** 14 Critical, 20 High, 16 Medium, 5 Low across entire codebase. Full report in `.squad/decisions.md`.

**Sokka's 4 Critical findings:**
1. Outlook tokens NOT in SENSITIVE_FIELDS → leaked to client via `GET /users/me`
2. No account deletion endpoint (GDPR/App Store violation)
3. Admin secret has hardcoded fallback `"slotted-admin-2026"` if env var unset
4. Friend list response includes email addresses — enables email harvesting

**Sokka's 7 High findings:**
- No input length validation on any text field (10MB title possible, causes DB bloat/OOM)
- `GET /friends` uses `select(*)` on joined users (tokens in memory)
- Race condition in friend request upsert (declined status can be overwritten)
- Availability overlap syncs friend's calendar without consent (privacy/quota concern)
- `parseInt(travelBuffer)` with no range validation (can be 99999 or negative)
- `zonedToUtc()` timezone helper has DST edge cases (off-by-hour during transitions)
- No friendship verification on `POST /meetups/:meetupId/counter-propose`

**Test Coverage Analysis:**
- Existing: 10 scenarios, ~1,881 lines, 75/80 passing (94%)
- **Critical untested paths (priority for next sprint):**
  1. Calendar sync engine (200+ lines, ZERO coverage) — most complex function
  2. OAuth token refresh/expiry — no expired/revoked token simulation
  3. Multi-friend overlap computation
  4. Google Calendar webhook handler (ZERO coverage)
  5. Account data lifecycle (endpoint missing)
  6. Concurrent operations & race conditions
  7. Timezone DST transitions
  8. FCM push notification delivery
  9. Admin endpoints (ZERO coverage — hardcoded secret is only barrier)
  10. Event discovery/matching (ZERO coverage)

**Recommendations (Priority Order):**
1. 🔴 Immediate: Add Outlook tokens to SENSITIVE_FIELDS (hotfix)
2. 🔴 Immediate: Remove admin secret fallback (hotfix)
3. 🟠 Sprint: Add account deletion endpoint (GDPR)
4. 🟠 Sprint: Remove email from friend response or make opt-in
5. 🟠 Sprint: Add input length validation middleware
6. 🟡 Next Sprint: Integration tests for calendar sync (mock Google API)
7. 🟡 Next Sprint: Friendship re-request cooldown logic
8. ⚪ Backlog: External rate limiter (Redis/Firestore)

**Cross-agent findings:**
- **Toph (Architecture):** 5 critical, 7 high. Key: plaintext tokens, social battery leak, hardcoded email, protobufjs RCE, zero RLS policies
- **Zuko (Backend):** 2 critical, 3 high, 3 medium. Key: hardcoded admin secret, OAuth CSRF, Apple CalDAV plaintext
- **Katara (Frontend):** 3 critical, 3 high, 4 accessibility gaps. Key: hardcoded email, console logs, open redirect, perf issues
- **Sokka (Testing):** 4 critical, 7 high, 9 medium, 5 low. Key: token leaks, missing deletion, no validation, DST bugs, untested paths

**Decisions written to:** `.squad/decisions.md` (all 4 audit findings merged with deduplication 2026-04-30)

### 2026-03-07: Comprehensive Bug & Edge Case Audit

**Critical Issues Found:**
1. Outlook OAuth tokens NOT in `SENSITIVE_FIELDS` → leaked to client via `GET /users/me`
2. No account deletion endpoint (GDPR/App Store violation)
3. Admin secret has hardcoded fallback `"slotted-admin-2026"` if env var unset
4. Friend list response includes email addresses of all friends

**Key Architectural Observations:**
- `functions/src/index.ts` is a 9400+ line monolith — all routes in one file
- Rate limiter is in-memory per-instance (resets on cold start, doesn't share across Firebase Functions instances)
- `GET /friends` query uses `select(*)` on joined user rows (tokens in memory even if not returned)
- `syncUserCalendar()` is called on a *friend's* behalf when computing overlap (privacy/rate-limit concern)
- No input length validation anywhere — all text fields accept unbounded input
- `zonedToUtc()` is a hand-rolled timezone helper with known DST edge cases

**Test Coverage Gaps (most dangerous untested paths):**
1. Calendar sync engine (200+ lines, zero tests)
2. OAuth token expiry/revocation handling
3. Multi-friend overlap computation
4. Google Calendar webhook handler
5. Admin endpoints (hardcoded secret)
6. Concurrent operation safety
7. FCM push notification delivery

**Privacy Findings:**
- Users CAN see friends' social battery status (opt-out doesn't exist)
- Users CAN infer friends' schedule from overlap boundaries (subtract from 8am-9pm window)
- Declined friendship can be bypassed by re-sending invite (upsert overwrites status)
- Friend deletion doesn't clean up group memberships or shared meetups

**Social Dynamics Review:**
- Decline language is good: "can't make it" (not "rejected" or "declined")
- Friend removal text is gentle: "You won't be able to see each other's availability anymore"
- "Not now" used for pending friend requests (not "Reject")
- Battery status exposure to friends could create guilt/pressure (LOW concern)

## Core Context (Summarized prior work)

### 2026-03-03 & Earlier: Two-Way Sync QA, CRIT Fixes, Test Planning

**Two-Way Sync Code Review (Phases 1-3):** Found 3 critical bugs (feedback loop prevention incomplete, disconnect cleanup orphaned channels, webhook returns 403 instead of 200 for unknown channels). HIGH-priority fixes: creator time change override (silently changes group meetups), 410 stale token retry missing. All 3 CRIT issues fixed by Zuko by 2026-03-03.

**Notification Dedup Test Coverage:** Created 6-test suite in `tests/agents/src/scenarios/notification-dedup.ts`. Patterns: cascading dedup (1hr relatedUserId → 5min relatedId → 10min title), type overloading (`friend_accepted` used for both friendship acceptance and group membership), unique index narrowed to `friend_request` only to avoid silently blocking legitimate group notifications.

**Phase 4 Recommendations:** Prioritize integration tests first (zero existing coverage — every past bug found via code review). Then structured logging (no sync visibility). Rate limiting and Apple CalDAV deferred.

**Two-Way Sync Test Scenarios:** 30 edge case scenarios documented. Key patterns: webhooks are "something changed" signals (must call events.list), 410 requires full re-sync, multi-calendar moves create false declines, webhook storms need debouncing (Cloud Tasks recommended).

**Key Architecture Learnings:**
- Webhook endpoint must return 200 for all requests, even errors (Google deactivates on 4xx)
- Google Calendar sync token going stale (410) requires immediate full re-sync retry in same webhook call
- No webhook debouncing in current implementation (stateless functions can't hold in-memory locks)
- Test language must match backend design (soft social dynamics: "can't make it" not "declined")

---

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

---

### Cross-Agent References (2026-02-27)

Katara shipped empty states and InvitePage. Toph designed webhook + incremental sync architecture. Test scenarios assume architecture decisions on 4 critical edge cases (multi-calendar moves, webhook debouncing, time drift policy, stale token recovery). Implementation blocked until those decisions made.

---

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

