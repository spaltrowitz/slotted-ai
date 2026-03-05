# Katara — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** React 19 + TS + Tailwind v4 + Vite (client/), Firebase Functions + Express (functions/), Supabase PostgreSQL
- **Frontend structure:** components in client/src/components/, pages in client/src/pages/, API calls in client/src/lib/api.ts, contexts in client/src/contexts/

## Learnings

<!-- Append learnings below -->

### Routing (QW-6)
- Public routes in App.tsx go before the `<Route element={<ProtectedRoute />}>` wrapper — alongside `/`, `/login`, `/privacy`
- InvitePage uses `/invite/:code` pattern — the code maps to `users.invite_code` in the DB
- Backend has `GET /users/invite/:code` (public, rate-limited) that returns `{ uid, displayName, photoUrl }`
- When a logged-in user lands on an invite page, auto-send friend request via `POST /friends/invite`

### Empty States (QW-1)
- Most pages already had partial empty states; the key gaps were: FriendsPage lacked CTA buttons, DashboardPage had no "friends exist but no hangouts" state
- Pattern: use `rounded-2xl border` cards with emoji + heading + body + CTA button, matching existing Slotted design tokens
- NotificationsPage and EventsPage already had thorough empty states — no changes needed
- FriendsPage has `handleText`, `handleEmail`, `handleCopy` methods already defined — reuse them in empty states
- DashboardPage tracks `allFriends` (all connected friends) and `upcoming` (future non-cancelled meetups) — use both to distinguish "no friends" vs "friends but no hangouts"

### Component Patterns
- Pages use `AppShell` wrapper for nav/layout; InvitePage does NOT use AppShell since it's a public landing page
- Gradient CTA buttons use `gradient-btn` class (project custom) — not raw Tailwind gradients
- Design tokens: `slotted-50` through `slotted-700`, `font-display` for headings
- Soft social language: "Ready to connect?" not "No friends yet", "Not this time" not "Decline"

---

## Cross-Agent References (2026-02-27)

### Suki's Landing Page Redesign (2026-03-03)
Suki redesigned LoginPage landing page (Early Access badge + "Why It Matters" section). Changes don't directly affect DashboardPage but inform global design consistency — dark panel + frosted glass cards pattern could be reused if needed. Type check passes.

### Sokka's Sync Testing (Two-Way Calendar Sync)
Sokka produced 30 test scenarios for two-way sync in `docs/plans/test-scenarios-two-way-sync.md`. Frontend impact: soft notification language rules apply to calendar-originated RSVP changes. See Sokka's learnings on notification language (never "declined," use "can't make it" or "stepped out").

### Toph's Two-Way Sync Architecture
Toph designed webhook + incremental sync architecture. Frontend doesn't change for Phase 1–3 (entirely server-driven). Phase 4 (Apple + hardening) may require additional calendar selection UI later.

### Performance Optimizations (2026-07)
- Enhanced DashboardPage skeleton to mimic real layout (greeting + calendar grid + avatar row + activity cards) instead of 2 plain gray rectangles. Uses `animate-pulse` per section.
- RouteLoadingFallback in App.tsx upgraded from a spinner to a structural skeleton — shown while any lazy-loaded page chunk downloads.
- Dashboard chunk prefetched via `requestIdleCallback` on page load — by the time user clicks "Sign in", the chunk is cached.
- DNS preconnect/prefetch hints added to index.html for googleapis, identitytoolkit, firebaseinstallations.
- Vite build config: `target: 'es2020'`, `cssMinify: true`, `reportCompressedSize: false` for smaller bundles and faster builds.
- No new dependencies introduced; all optimizations are pure config + Tailwind markup.
