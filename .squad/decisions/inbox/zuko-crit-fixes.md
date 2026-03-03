# CRIT Fixes: Two-Way Calendar Sync — Zuko

**Date:** 2025-07-24
**Author:** Zuko (Backend Dev)
**Status:** Implemented — pending deploy

## Summary

Fixed 3 critical bugs from Sokka's code review of the Two-Way Calendar Sync feature. All fixes are in `functions/src/index.ts`. Build passes.

## CRIT-1: Feedback Loop Prevention Broken

**Problem:** `rsvp_source` was selected in the participant query but never checked. A stale Google webhook could overwrite an RSVP change the user just made in the app.

**Fix:**
- Added `gcal_last_synced_at` to the participant select query (~line 7607)
- Added `isRecentAppChange` guard after the etag check: if `rsvp_source === 'app'` AND the last sync was within 60 seconds, skip the RSVP overwrite
- Applied guard to both the cancelled-event path and the RSVP-mapping path
- Fixed a secondary bug: the cancelled-event `continue` was skipping the etag update — now explicitly updates etag before continuing

## CRIT-2: Disconnect Doesn't Clean Up Watch State

**Problem:** `POST /calendar/disconnect` cleared OAuth tokens but left `calendar_watch_channel`, `calendar_watch_resource_id`, `calendar_sync_token` in the users table, and `google_event_id` in meetup_participants. This caused zombie watch channels and sync confusion on reconnect.

**Fix:**
- Added `calendar_watch_channel: null, calendar_watch_resource_id: null, calendar_sync_token: null` to the user update payload (~line 6536)
- Added a query to null out `google_event_id` on all of the user's meetup_participants rows (~line 6548)

## CRIT-3: Webhook Returns 403 for Unknown Tokens

**Problem:** The Google Calendar webhook endpoint returned `403` for invalid/missing tokens. Google deactivates webhook endpoints that return 4xx errors, which would silently kill the entire sync pipeline.

**Fix:**
- Changed from `res.status(403)` to `console.warn()` + `res.status(200).send("OK")` (~line 7800)
- Google requires 200 for ALL webhook requests — we log the bad token for investigation but never reject the request

## Verification

- `cd functions && npm run build` — passes ✅
- No schema changes required (all columns already exist)
