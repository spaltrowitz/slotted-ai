## Decision: React Query Migration for Page Data (Katara, 2026-07)

| Field | Value |
|---|---|
| **Author** | Katara (Frontend Dev) |
| **Status** | Implemented |
| **Scope** | Page data fetching + mutations in client/src/pages |

### Decision

Move all page-level data loading to React Query and centralize query keys + fetchers in `client/src/lib/queries.ts` to eliminate one-off `useEffect` fetch patterns.

### Key Choices

1. **Canonical query keys** for dashboard, friends, notifications, settings, events suggestions/saved, and calendar events.
2. **`useQuery` for page loads** with derived state from cached data instead of local fetch state.
3. **`useMutation` for POST/PATCH/DELETE** with `invalidateQueries` and cache updates for optimistic UI (busy blocks, RSVP, friend actions).

### Files Changed

- `client/src/lib/queries.ts`
- `client/src/pages/DashboardPage.tsx`
- `client/src/pages/FriendsPage.tsx`
- `client/src/pages/EventsPage.tsx`
- `client/src/pages/NotificationsPage.tsx`
- `client/src/pages/SettingsPage.tsx`
- `client/src/pages/OnboardingPage.tsx`
