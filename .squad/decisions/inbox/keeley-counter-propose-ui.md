# Decision: Counter-Propose Notification Action Buttons (Keeley)

| Field | Value |
|---|---|
| **Author** | Keeley (Frontend Dev) |
| **Date** | 2026-03-02 |
| **Status** | Implemented |
| **Scope** | `meetup_counter_propose` notification interactivity |

## Decision

Upgraded `meetup_counter_propose` notifications from informational (View meetup link) to actionable with two buttons:

- **"💡 Update time"** — violet accent, primary action. Calls `PATCH /meetups/:id/rsvp` with `accepted` as an acknowledgment signal, then marks notification read.
- **"Keep original"** — muted secondary. Marks notification read without any API side effect.

Moved `meetup_counter_propose` from `reminderTypes` to `requestTypes` so it appears in the Requests tab.

## Key Choices

1. **Three-state rendering:** Unread → action buttons; acted-on → confirmation pill ("✅ Time updated" / "Kept original time"); already-read (e.g. from another device) → "View meetup" link fallback.
2. **Soft language:** "Update time" / "Keep original" — no "Accept" / "Reject" / "Dismiss." Follows Slotted's collaborative tone.
3. **RSVP endpoint as interim signal:** There's no dedicated "accept counter-proposal" backend endpoint. Using the RSVP endpoint is a pragmatic placeholder. When Roy adds a proper endpoint, `handleCounterProposeAction` should be updated.
4. **Violet accent for primary button:** Matches the `meetup_counter_propose` type theme color (violet) from `typeConfig`.

## Open Items

- Backend: Need a dedicated endpoint to actually update the meetup time when the creator accepts a calendar-originated counter-proposal. Current RSVP call is a signal, not a time update.
- When a meetup detail page is built, the "View meetup" fallback link should point there instead of `/dashboard`.
