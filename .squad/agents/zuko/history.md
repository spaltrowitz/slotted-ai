# Zuko — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** Firebase Functions + Express + TS (functions/), Supabase PostgreSQL (database/schema.sql), Firebase Auth
- **Backend structure:** routes in functions/src/index.ts, Supabase client in functions/src/supabase.ts, migrations in migrations/

## Learnings

<!-- Append learnings below -->

### CORS Configuration (QW-4 fix)
- **Location:** `functions/src/index.ts` lines 42–60
- **Allowed origins:** `localhost:5173`, `localhost:5174` (dev), `slotted-ai.web.app`, `slotted-ai.firebaseapp.com` (prod)
- **Pattern:** The `cors` package's `origin` callback takes `(Error | null, boolean)`. Use `callback(new Error("Not allowed by CORS"))` to reject unknown origins — this is the standard rejection pattern from the cors docs.
- **No-origin requests** (mobile apps, curl, server-to-server) are allowed through via `!origin` check — this is intentional and standard.
- **Security note:** The original code had `callback(null, true)` in the else branch, meaning ANY domain could make authenticated cross-origin requests. This was a security hole.

### CRIT-1: Feedback Loop Prevention in processCalendarChanges()
- **Location:** `functions/src/index.ts` ~lines 7607–7640
- **Problem:** `rsvp_source` was selected but never checked. Stale webhooks could overwrite app-sourced RSVP changes.
- **Fix:** Added `isRecentAppChange` guard: if `rsvp_source === 'app'` AND `gcal_last_synced_at` is within 60 seconds, skip RSVP changes but still update etag. Applied to both cancelled-event and RSVP-mapping paths.
- **Key insight:** The cancelled-event path had a `continue` that skipped the etag update at the end of the loop. Added explicit etag update before the continue.

### CRIT-2: Calendar Disconnect Cleanup
- **Location:** `functions/src/index.ts` ~lines 6536–6555
- **Problem:** Disconnect only cleared OAuth tokens, leaving watch channel, resource ID, sync token, and google_event_id intact. Stale watch channels would keep firing webhooks; orphaned google_event_ids would cause sync confusion on reconnect.
- **Fix:** Added `calendar_watch_channel: null, calendar_watch_resource_id: null, calendar_sync_token: null` to user update. Added separate query to null `google_event_id` on user's meetup_participants rows.

### CRIT-3: Webhook Must Always Return 200 to Google
- **Location:** `functions/src/index.ts` ~line 7800
- **Problem:** Webhook returned 403 for invalid tokens. Google deactivates webhook endpoints that return 4xx.
- **Fix:** Changed to `console.warn()` + `res.status(200).send("OK")`. Google requires 200 for ALL webhook requests, even invalid ones.
- **General rule:** Any Google webhook handler must NEVER return non-2xx. Log the problem, respond 200.
