# Zuko — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** Firebase Functions + Express + TS (functions/), Supabase PostgreSQL (database/schema.sql), Firebase Auth
- **Backend structure:** routes in functions/src/index.ts, Supabase client in functions/src/supabase.ts, migrations in migrations/

## Learnings

<!-- Append learnings below -->

2026-03-03: Firebase deploy succeeded after .env was populated with real credentials. All 5 functions live at https://api-xwsmuazwmq-uc.a.run.app. Migration columns still pending user action in Supabase SQL Editor.

### Deploy Attempt — Firebase Functions (2026-03-03)

**Result: FAILED — two blockers identified.**

#### Blocker 1: Placeholder env vars in `functions/.env`
Three required variables still have `PASTE_YOUR_*` placeholder values, not real credentials:
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

The other three vars (`SUPABASE_URL`, `GOOGLE_REDIRECT_URI`, `FRONTEND_URL`) have real values. `GOOGLE_WEBHOOK_SECRET` also has a value.

#### Blocker 2: Deploy timeout during code analysis
Firebase CLI timed out loading user code (`Timeout after 10000`). The env var FATAL message printed (all 6 vars reported missing), meaning Firebase CLI 15.8.0 may not be loading `functions/.env` during the deploy analysis phase at all. Additionally, `package.json` specifies `"engines": { "node": "24" }` — Firebase Cloud Functions may not yet support Node.js 24. Recommend checking supported runtimes.

#### Migration Status Check
The migration file `migrations/two_way_calendar_sync.sql` has 5 statements. Per prior session notes, statement 5 (DROP CONSTRAINT on notifications) was already run. Without direct Supabase access, I cannot verify which of statements 1–4 were applied. The user should run the column-check query below in Supabase SQL Editor to determine what's missing, then run only the missing ALTER statements.

### CRIT Fixes Delivered (2026-03-03, commit 5db77f9)

**Fixed all 3 critical bugs from Sokka's code review. Build passes. Ready for production.**

#### CRIT-1: Feedback Loop Prevention
- **Location:** `functions/src/index.ts` ~lines 7607–7640
- **Problem:** `rsvp_source` was selected but never checked. Stale webhooks could overwrite app-sourced RSVP changes.
- **Fix:** Added `isRecentAppChange` guard: if `rsvp_source === 'app'` AND `gcal_last_synced_at` within 60s, skip RSVP change. Applied to both cancelled-event and RSVP-mapping paths.
- **Secondary fix:** Cancelled-event path now explicitly updates etag before skipping (was missing).

#### CRIT-2: Disconnect Cleanup
- **Location:** `functions/src/index.ts` ~lines 6536–6555
- **Problem:** `POST /calendar/disconnect` cleared OAuth tokens but left `calendar_watch_channel`, `calendar_watch_resource_id`, `calendar_sync_token`, and `google_event_id` orphaned. Stale watch channels kept firing webhooks; sync confusion on reconnect.
- **Fix:** Added `calendar_watch_channel: null, calendar_watch_resource_id: null, calendar_sync_token: null` to user update. Added separate query to null `google_event_id` on user's meetup_participants rows.

#### CRIT-3: Webhook Returns 200 for All Requests
- **Location:** `functions/src/index.ts` ~line 7800
- **Problem:** Webhook returned 403 for invalid tokens. Google deactivates endpoints that return 4xx errors.
- **Fix:** Changed to `console.warn()` + `res.status(200).send("OK")`. Google requires 200 for ALL webhook requests.
- **Pattern:** Any Google webhook handler must NEVER return non-2xx. Log the error, respond 200.

#### Sokka's Review Status
Code review identified 15/30 test scenarios fully covered, 9/30 partial, 4/30 missing (3 of which were the criticals now fixed). Notification language audit passed ✅. Ready for production deployment.

---

### CORS Configuration (QW-4 fix)
- **Location:** `functions/src/index.ts` lines 42–60
- **Allowed origins:** `localhost:5173`, `localhost:5174` (dev), `slotted-ai.web.app`, `slotted-ai.firebaseapp.com` (prod)
- **Pattern:** The `cors` package's `origin` callback takes `(Error | null, boolean)`. Use `callback(new Error("Not allowed by CORS"))` to reject unknown origins — this is the standard rejection pattern from the cors docs.
- **No-origin requests** (mobile apps, curl, server-to-server) are allowed through via `!origin` check — this is intentional and standard.
- **Security note:** The original code had `callback(null, true)` in the else branch, meaning ANY domain could make authenticated cross-origin requests. This was a security hole.

### HIGH Severity Fixes from Sokka's QA Review (Phase 4)

**Both fixes in `functions/src/index.ts`. Build passes.**

#### HIGH-1: Group Meetup Time Change Protection (~line 8342)
- **Problem:** Creator dragging a meetup event in Google Calendar auto-updated the meetup time for ALL participants, even in group meetups (3+). One person shouldn't unilaterally reschedule a group.
- **Fix:** Added participant count check using `select("id", { count: "exact", head: true })`. If >2 participants (group meetup), time is NOT auto-updated — instead, a notification is sent: "wants to change the time" with the proposed time. For 1:1 meetups (≤2 participants), existing auto-update behavior is preserved.
- **Pattern:** Use Supabase `{ count: "exact", head: true }` for efficient count-only queries — no data transfer, just the count header.
- **Notification language:** Group uses "wants to change" (soft proposal). 1:1 uses "updated" (fait accompli). Matches Slotted's soft social dynamics principle.

#### HIGH-2: 410 Stale Sync Token Immediate Retry (~line 8541)
- **Problem:** When Google returned 410 for a stale sync token, the code cleared the token but exited. The current webhook's changes were lost — only the NEXT webhook would trigger a full sync.
- **Fix:** After clearing the stale token, immediately retries `events.list` without `syncToken` (full sync). Processes the returned events and saves the new sync token. Wrapped in its own try/catch so a retry failure doesn't mask the original 410 handling.
- **Guard against infinite loops:** Only one retry per webhook call — the retry doesn't use a sync token, so it can't get another 410. If the retry itself fails for a different reason, it logs and moves on.
- **Pattern:** For Google Calendar sync, always handle 410 with clear-and-retry-immediately, not clear-and-wait.

### Notification Dedup Review (2025-07-25)

**Reviewed the duplicate notifications fix. Found and fixed a critical issue in the migration.**

#### What Was Already Fixed (Confirmed Good) ✅
- `createNotification` dedup logic: cascading checks (relatedUserId 1hr → relatedId 5min → title 10min). Correctly detects duplicates across code paths that use different field combinations.
- Removed buggy `.single()` dedup in connect-referral and PATCH friends accept — both now rely on createNotification's internal dedup.
- 23505 constraint violation handler silently catches DB-level dupes.

#### Issue Found & Fixed: Unique Index Too Broad ❌→✅
- **Problem:** The migration's unique partial index covered both `friend_accepted` AND `friend_request` types. But `friend_accepted` is **reused for group membership notifications** (added to group, removed from group) at lines 3298, 3319, 3408, 3428. These use the same `(user_id, type, related_user_id)` tuple as real friend acceptance notifications. The index would silently block legitimate group notifications via the 23505 handler.
- **Fix:** Narrowed the unique index to `friend_request` only. App-level dedup handles `friend_accepted` correctly.
- **Also fixed:** Step 1 DELETE was too aggressive — deduplicating ALL notification types including meetups and calendar_match. Scoped it to only `friend_request` (safe, single call site) and `friend_accepted` with title pattern matching to avoid deleting group notifications.

#### Key Pattern: `friend_accepted` Type Overload
- `friend_accepted` is used for: actual friend acceptances, group add notifications, group remove notifications. This type overloading is tech debt — a future `group_update` type would be cleaner.
- **Never add DB unique constraints on `friend_accepted` notifications** without accounting for group usage.

#### All createNotification("friend_accepted") Call Sites Verified
- Line 838: auto-connect from pending invites (relatedUserId only)
- Line 1474: connect-referral (relatedUserId + relatedId)
- Line 1559: PATCH friends accept (relatedUserId + relatedId)
- Lines 3298, 3319, 3408, 3430: group membership changes (relatedUserId only)
- All covered by the 1-hour relatedUserId dedup window. No remaining race conditions.

### Notification Dedup Review & Hardening (2026-03-04)

**Session:** Zuko reviewed & hardened dedup migration; Sokka created comprehensive E2E test suite.

#### Migration Hardening
- Narrowed unique index from both `friend_accepted` AND `friend_request` to `friend_request` only
- Root cause: `friend_accepted` overloaded for group membership changes; DB constraint would silently block legitimate group notifications
- Scoped cleanup DELETE to title-matched friend acceptance patterns
- Tech debt: future `group_update` type would enable proper unique index on friend_accepted

#### Test Coverage (Sokka)
- 6-test scenario suite in `tests/agents/src/scenarios/notification-dedup.ts`
- Added `connectReferral()` and `acceptFriendshipAction()` to client SDK
- Tests: single connect, rapid reconnect dedup, type coexistence, user pair independence, global invariants
- Run: `npm run scenario:notification-dedup` from `tests/agents/`
