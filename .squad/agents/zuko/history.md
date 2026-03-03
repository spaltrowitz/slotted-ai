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
