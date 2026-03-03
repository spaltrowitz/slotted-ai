# Keeley — Frontend Dev History

## Learnings

- **Notification type system:** The `Notification` interface in `NotificationsPage.tsx` uses a string union type for `type`. New notification types require updating: (1) the type union, (2) `typeConfig` emoji/color mapping, (3) tab filter arrays (`requestTypes` or `reminderTypes`), and optionally (4) per-type action buttons.
- **No meetup detail route:** There is no `/meetups/:id` detail page. Meetup-related notifications link to `/dashboard` as the closest available view.
- **Tab filtering:** Notifications are grouped into tabs via `requestTypes` (actionable) and `reminderTypes` (informational). Calendar-sync notifications (`meetup_rsvp_changed`, `meetup_time_changed`, `meetup_counter_propose`) are informational for now, placed in Reminders.
- **Soft language convention:** Slotted uses warm, non-judgmental language — "updated their availability" not "declined," "suggests a different time" not "rejected your time." This is enforced in notification copy, not in frontend code (copy comes from the backend `body` field).
- **Counter-propose action buttons:** `meetup_counter_propose` notifications now have "Update time" (violet accent) and "Keep original" (muted) buttons. Uses `handleCounterProposeAction` handler with `counterProposeActionDone`/`counterProposeActionLoading` state. After acting, shows a confirmation pill. If already read, falls back to "View meetup" link.
- **Tab migration pattern:** When a notification type becomes actionable, move it from `reminderTypes` to `requestTypes`. Done for `meetup_counter_propose` when action buttons were added.
- **No dedicated accept-counter-proposal API:** Backend has no endpoint to directly accept a calendar-originated time change. "Update time" currently calls the RSVP endpoint as an acknowledgment signal. When a dedicated endpoint is added, update `handleCounterProposeAction`.
