# Orchestration: Katara — Mobile Calendar Grid Removal (2026-03-05T15:35:00Z)

| Field | Value |
|---|---|
| **Agent** | Katara (Frontend Dev) |
| **Task** | Replace mobile calendar grid with Upcoming Hangouts list |
| **Model** | claude-sonnet-4.5 |
| **Mode** | Background |
| **Started** | 2026-03-05T15:35:00Z |
| **Completed** | 2026-03-05T15:45:00Z (estimated) |
| **Status** | ✅ Completed |

## Scope

- Remove 3-day calendar grid on mobile (keep full grid on desktop)
- Add compact "This Week" / "Next Week" hangout list with pending/confirmed status
- Hide calendar-specific UI on mobile (Mark Busy, no-events nudge)
- Empty state: "No hangouts coming up" with "Find a time with a friend" CTA

## Changes Made

**File: `client/src/pages/DashboardPage.tsx`**
- Wrapped calendar section with `!isMobile` guard
- Added mobile-only `<div>` rendering upcoming hangouts list
- Implemented `upcomingByWeek` useMemo grouping meetups by This Week / Next Week
- Hidden "Calendar connected but no events" nudge on mobile
- Hidden "Mark Busy" paragraph on mobile
- Empty state on mobile: "No hangouts coming up" with CTA button

## QA Checklist

- ✅ TypeScript type checking passes (`cd client && npx tsc --noEmit`)
- ✅ Build succeeds (`npm run build`)
- ✅ Desktop calendar grid unchanged
- ✅ Mobile shows list, no grid
- ✅ Groups by week boundaries (Sunday–Saturday)
- ✅ Displays pending/confirmed status per meetup

## Next Steps

- Scribe merges decision into `.squad/decisions.md`
- Git commit staged via `git add client/src/ .squad/`
- Deploy via Firebase Hosting
