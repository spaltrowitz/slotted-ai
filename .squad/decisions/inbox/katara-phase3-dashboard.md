# Decision: Phase 3 — Progressive Dashboard Architecture

**Date:** 2026-07-25
**Author:** Katara (Frontend Dev)
**Status:** Implemented

## Decision

DashboardPage now renders different full-screen experiences based on a `UserStage` computed from existing data (calendar connection, friend count, pending invites, hangout counts). The stage logic lives in `client/src/lib/userStage.ts` as a pure function.

## Rationale

All three designers (Ty Lee, Suki, Mai) agreed the Dashboard should reflect reality — not show empty sections with headers. The progressive approach means Day 1 users see a single invite CTA (not 15 empty widgets), while active users see upcoming hangouts and reconnect suggestions.

## What Changed

- `client/src/lib/userStage.ts` — new file, 6-stage type union + pure function
- `client/src/pages/DashboardPage.tsx` — full rewrite, 1341 → ~370 lines
- Removed: calendar view, activity feed, event suggestions, saved events, hangout history/log form, HowItWorks, all related state/mutations
- Kept: dashboard/friends/meetups queries, friend action mutation, AddToCalendarModal

## Impact

- **No backend changes needed** — all data already fetched by existing queries
- **FriendsPage unaffected** — scheduling flow still works via `/friends?findTimes=<id>`
- **NotificationDropdown unaffected** — bell icon still in AppShell
- **Activity feed, event suggestions, saved events queries** still exist in queries.ts but are no longer imported by DashboardPage. They may be used elsewhere or can be cleaned up later.

## Trade-offs

- The "Log hangout" form and hangout history section were removed from Dashboard. If needed, they could be added to a dedicated History page or under Settings.
- Event suggestions/saved events are no longer surfaced on Dashboard. If Events returns in V2, it would get its own surface.
