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

### Two-way calendar sync Phase 3 (time change detection)
- Time change logic added inside `processCalendarChanges()`, replacing the Phase 3 placeholder comment (around line 7632).
- Compares ISO-stringified `event.start`/`event.end` against `meetup.start_time`/`meetup.end_time`.
- Creator moves → updates `meetups` row directly + sends `meetup_time_changed` notification to all other participants.
- Non-creator moves → sends `meetup_counter_propose` notification to the creator only. Meetup times are NOT changed.
- Notification types `meetup_time_changed` and `meetup_counter_propose` were already present in `migrations/two_way_calendar_sync.sql` CHECK constraint from Phase 2.
- `createNotification` signature uses `userId`, `type`, `title`, `body`, `relatedUserId`, `relatedId` — matches existing codebase pattern exactly.
