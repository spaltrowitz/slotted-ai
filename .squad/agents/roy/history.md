# Roy — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** Firebase Functions + Express + TS (functions/), Supabase PostgreSQL (database/schema.sql), Firebase Auth
- **Backend structure:** routes in functions/src/index.ts, Supabase client in functions/src/supabase.ts, migrations in migrations/

## Learnings

### Two-way calendar sync Phase 1–2 (watch + RSVP)
- Watch creation added to `/calendar/callback` after calendar list storage; teardown runs at the start of `/calendar/disconnect` before token clearing.
- `processCalendarChanges()` + helpers live above the Google webhook handler; the webhook now runs `syncUserCalendar()` then an incremental events.list with sync token handling.
- `renewCalendarWatchChannels` is inserted at the top of the Scheduled Functions section before `sendMeetupReminders`.
- `syncUserCalendar()` now uses `calendar_sync_token` for the primary calendar (id or email) with 410 fallback.
