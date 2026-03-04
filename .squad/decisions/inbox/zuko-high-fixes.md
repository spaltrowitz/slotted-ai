# Decision: Group Meetup Time Changes Require Consent

**Author:** Zuko (Backend Dev)
**Date:** 2025-07-24
**Status:** Implemented
**Scope:** `processCalendarChanges` in `functions/src/index.ts`

## Context

Sokka's QA review (HIGH-1) identified that when a meetup creator drags a calendar event to a new time, the system auto-updated the meetup time for ALL participants — including group meetups. This violates Slotted's "no social pressure" principle: one person shouldn't unilaterally reschedule a group.

## Decision

- **Group meetups (3+ participants):** Creator time changes via Google Calendar do NOT auto-update the meetup. Instead, all other participants receive a notification: "wants to change the time" with the proposed new time. The meetup keeps its original time.
- **1:1 meetups (2 participants):** Auto-update behavior is preserved. The other participant gets a "updated the time" notification (existing behavior).

## Rationale

- Group dynamics are fundamentally different from 1:1. Changing a group's schedule requires buy-in.
- Notification language is intentionally soft ("wants to" vs "updated") per Slotted design principles.
- Future work: a proper counter-propose/vote flow for group time changes. For now, notification-only is the safe default.

## Trade-offs

- The group's meetup time stays frozen until a proper reschedule mechanism exists. This is better than silently overriding everyone.
- The creator's Google Calendar event may now be out of sync with the Slotted meetup time (their drag moved it, but Slotted didn't follow). Acceptable for now.

---

# Decision: 410 Stale Sync Token — Immediate Full Sync Retry

**Author:** Zuko (Backend Dev)
**Date:** 2025-07-24
**Status:** Implemented
**Scope:** Webhook handler in `functions/src/index.ts`

## Decision

When Google returns a 410 (stale sync token), the webhook handler now:
1. Clears the sync token in the database
2. Immediately retries with a full sync (no syncToken)
3. Processes all returned events and saves the new sync token

Previously, it cleared the token and exited — causing a one-webhook delay before sync caught up.

## Guard Rails

- Max 1 retry per webhook call (full sync can't produce another 410)
- Retry failure is caught separately and logged — doesn't affect the main error handling
