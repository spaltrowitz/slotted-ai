# Decision: Time Change Detection — Creator vs Non-Creator Routing

**Author:** Roy (Backend Dev)
**Date:** 2026-03-03
**Status:** Implemented
**Scope:** Two-Way Calendar Sync — Phase 3

## Decision

When a Google Calendar event time changes for a Slotted meetup, the system routes differently based on who moved it:

1. **Creator moved the event** → Meetup `start_time`/`end_time` updated directly in the `meetups` table. All other participants get a `meetup_time_changed` notification. This is consistent with the creator being the authority for the meetup.

2. **Non-creator moved the event** → No meetup times are changed. The creator receives a `meetup_counter_propose` notification with the suggested new time in the body text. This respects the principle that only the creator can officially reschedule.

## Key Choices

- **ISO string comparison** for time equality — avoids timezone edge cases by normalizing both sides to `toISOString()` before comparing.
- **No threshold/drift logic** — any time difference triggers the flow. Sokka flagged thresholds (< 30 min auto-accept, > 1 hour counter-propose) but the plan spec says to treat all changes equally for now. Thresholds can be layered on later.
- **Counter-propose is notification-only** — there's no accept/dismiss UI yet (deferred per Keeley's decision doc). The notification body includes the proposed new time as readable text.

## Files Changed

- `functions/src/index.ts` — replaced Phase 3 placeholder in `processCalendarChanges()` with time comparison + notification logic
