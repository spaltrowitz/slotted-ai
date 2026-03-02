# Josh — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** React 19 + TS + Vite (client/), Firebase Functions + Express (functions/), Supabase PostgreSQL
- **Test location:** tests/

## Learnings

<!-- Append learnings below -->

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
- `.squad/decisions/inbox/josh-sync-edge-cases.md` — 4 critical architecture questions for Leo

---

## Cross-Agent References (2026-02-27)

### CJ's Empty States & Invite Route (QW-1, QW-6)
CJ shipped empty state strategy and InvitePage. From QA perspective, ensure notifications respect soft language (no "declined," use "can't make it"). InvitePage inviter lookup (`GET /users/invite/:code`) backend is already live; verify public route accessibility in tests.

### Leo's Two-Way Sync Architecture
Leo designed webhook + incremental sync for calendar changes. Test scenarios in this file assume decisions on 4 critical edge cases (multi-calendar moves, webhook debouncing, time drift policy, stale token recovery). Implementation is blocked until those decisions are made.
