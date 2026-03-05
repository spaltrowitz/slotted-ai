# Katara — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** React 19 + TS + Tailwind v4 + Vite (client/), Firebase Functions + Express (functions/), Supabase PostgreSQL
- **Frontend structure:** components in client/src/components/, pages in client/src/pages/, API calls in client/src/lib/api.ts, contexts in client/src/contexts/

## Learnings

<!-- Append learnings below -->

### Phase 1 UI Simplification Removals Completed (2026-03-05T18:22:54Z)
Phase 1 frontend removals completed successfully. Orchestration log: `.squad/orchestration-log/2026-03-05T18:22:54Z-agent-11-katara.md`. Decision merged to `.squad/decisions.md`. Cross-agent dependency: GroupAvailability.tsx API call needs update from `/availability/group-overlap` to `/availability/multi-friend-overlap` (Zuko's backend rename). Type check passes clean.

### Phase 1 UI Simplification Removals (2026-07)
- **Groups removed from FriendsPage:** All group state (11 useState vars), 3 mutations (create/delete/add-member), all group handlers, the groups query, group UI sections (groups list, create form, delete modal, add-member panel, non-friend request buttons). The GroupAvailability component still exists for multi-friend scheduling — just no longer triggered through saved groups.
- **Groups removed from queries.ts:** `SavedGroup` interface, `fetchGroups()`, `groups` query key all deleted. No group-related API calls existed in `api.ts` (they were inline via `api.post/delete` in FriendsPage).
- **Events route removed from App.tsx:** `EventsPage` lazy import and `/events` route removed. The `EventSharePage` public route (`/e/:code`) remains. Events was NOT in AppShell nav — it was already only accessible via direct URL or links.
- **Calendar view removed from DashboardPage:** Entire desktop calendar grid (week/month/agenda views), mark-busy mode (drag-to-select), busy block mutations, all calendar view helpers (weekDays, monthGrid, eventStyle, formatEventTime, etc.), and the "calendar connected but no events" nudge. Calendar data still fetched (14 days) for the header "today at a glance" summary. AddToCalendarModal kept (it's for meetup confirmation, not the calendar view). The "Mark Busy" reference in the connect-calendar CTA was also removed.
- **HowItWorks removed from DashboardPage:** `<HowItWorks />` rendering removed. The component function still exists in the file — will be repurposed for /help page later.
- **Score emojis removed from FriendAvailability, GroupAvailability, EventsPage:** `scoreEmoji()` function and its 🔥👍🤔😐 display removed from all three files. Numeric score badge also removed from FriendAvailability and GroupAvailability time slots. EventsPage keeps its score badge (different context: event-friend match quality, not time slot scoring).
- **Group notification detection removed from NotificationsPage:** `isGroupMembershipUpdate` regex removed; `isFriendJoinedNotification` simplified to just check `type === 'friend_accepted'`.
- **Dependency chain:** `inviteFriendMutation` in FriendsPage was only used by `handleGroupMemberFriendRequest` — removing groups made it dead code, so it was also removed.
- **`useCallback` removed from DashboardPage imports:** All useCallback usages were in busy-block handlers which were removed.
- **`calEventsLoading` no longer exists:** Was the `isFetching` from the calendar query, only used by the removed calendar UI and the "no events" nudge. Simplified query no longer destructures it.
- Type check: `cd client && npx tsc --noEmit` passes clean after all changes.

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

### React Query Migration (2026-07)
- `client/src/lib/queries.ts` now centralizes React Query keys + fetchers for dashboard, friends, events, notifications, settings, and calendar events.
- Page data loads use `useQuery`; POST/PATCH/DELETE flows use `useMutation` with query invalidation and cache updates for optimistic UI.

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

### Mobile Calendar Removal (2026-07)
- On mobile, the full calendar grid (week/month/agenda views, Mark Busy, calendar navigation) is replaced with a compact "Upcoming Hangouts" list grouped by "This Week" / "Next Week".
- Desktop keeps the full calendar grid — no changes.
- The `upcomingByWeek` useMemo groups meetups by current and next calendar week (Sunday–Saturday), sorted chronologically.
- Each hangout row shows: day abbreviation, time, title, and status (`confirmed ✓` or `pending`) — follows Slotted soft-social language.
- Empty state when no upcoming meetups: "No hangouts coming up" + CTA to find times with a friend.
- The "Calendar connected but no events" nudge and the "Mark Busy" reference in the connect-calendar CTA are both hidden on mobile since they reference the calendar grid.
- `isMobile` from `useIsMobile()` hook drives all conditional rendering — no new hooks or state.

### Workbox PWA Asset Caching (2026-07)
- Installed `vite-plugin-pwa` with `generateSW` mode — Workbox generates the full SW from config, no custom SW file needed.
- Coexistence approach: `importScripts: ['./firebase-messaging-sw.js']` in the Workbox config pulls Firebase messaging code into the generated `sw.js`. Single SW handles both caching and push notifications.
- `usePushNotifications.ts` updated to pass `serviceWorkerRegistration` (from `navigator.serviceWorker.ready`) to Firebase's `getToken()` — prevents Firebase from registering a second SW at `/firebase-messaging-sw.js`.
- `registerSW({ immediate: true })` in `main.tsx` triggers auto-update on new deploys.
- `manifest: false` because we already have `/public/manifest.json`.
- Type reference for `virtual:pwa-register` added to `vite-env.d.ts`.
- NetworkOnly rules for Firebase Auth (`identitytoolkit`/`securetoken`), Google Calendar API, and `/api/calendar/` must come BEFORE the general `/api/` StaleWhileRevalidate rule — Workbox evaluates routes in order.

### Phase 2 UI Simplification (2026-07)
- **Notifications → Bell Dropdown:** Created `NotificationDropdown.tsx` component that renders as a bottom sheet on mobile (max 60vh, swipe-down to close) and a dropdown on desktop. Bell icon with unread count badge added to AppShell header. All notification actions (RSVP, friend request accept/decline, counter-propose, add-to-calendar) work inline within the dropdown. NotificationsPage.tsx preserved for deep-link targets (`/notifications` route still in App.tsx) but no longer in nav.
- **Settings → 3 Sections:** Replaced 4-tab SettingsPage with single scrollable page: Calendar (top, prominent) → Account (display name, sign out) → Advanced (collapsed accordion). Advanced contains: planning style, social battery, recharging days, social goal, sharing toggle, in-person hangouts (neighborhoods, office days, preferred times, hangout duration, travel buffer), calls & FaceTime (call duration, platforms, call windows), event interests, notification preferences. Accordion uses `animate-slide-up` on expand.
- **Nav → 2 Bottom Tabs:** Bottom nav reduced from 4 tabs (Home, Friends, Inbox, Settings) to 2 (Home, Friends). Header now has: [Logo + desktop nav] ... [Bell icon with badge] [Profile/Settings avatar]. Desktop nav shows Home, Friends, Settings (3 items). Sign out button removed from header — now in Settings page Account section.
- **Key patterns:** NotificationDropdown uses `position: fixed` with `z-[60]`/`z-[70]` for backdrop/sheet. Bell button is `relative` container for the dropdown on desktop. useCallback for `closeNotifications` to avoid re-renders. AppShell fetches notifications for unread count badge.
- Type check: `cd client && npx tsc --noEmit` passes clean.

### Phase 2B UI Simplification (2026-07)
- **FriendsPage cards → list rows:** Removed INTEREST_LABELS, fetchUserSettings query, updateFriendshipTypeMutation, local/long-distance segmentation, batteryEmoji/batteryLabel helpers, renderFriendCard with all sub-elements (interest badges, calendar sync status, hangout cadence). Replaced with simple `renderFriendRow`: 36px avatar, name, "last seen X days ago" caption, chevron. Added multi-select mode (long-press 500ms or Select toggle) with checkmark overlays and floating bottom bar for batch "Find time for N friends." Added "+ Invite a friend" row at bottom. Changed "Decline" to "Not now" for incoming invites (soft social language).
- **Onboarding 3 steps → 1 step:** Removed steps 2 (city) and 3 (preferred times). Removed OnboardingData interface, steps array, step state, back/next navigation, stepEmojis. Kept only calendar connect screen with warm welcome text. Shows "Continue" button only after calendar is connected. Mutation sends empty preferredTimes array.
- **Help page created:** `client/src/pages/HelpPage.tsx` with 4 numbered steps repurposed from HowItWorks content. Route added to App.tsx at `/help` under protected routes. Link added in SettingsPage after feedback section.
- **8-emoji policy enforced:** Stripped ALL non-allowed emojis from entire frontend. Only 🟢🟡🔴✅⏳⭐⚠️❤️ remain. Affected files: DashboardPage, FriendsPage, OnboardingPage, SettingsPage, LoginPage, EventsPage, EventSharePage, NotificationsPage, FriendAvailability, SocialBattery, CounterProposePanel, GroupAvailability, AddToCalendarModal, InstallPrompt, CalendarPicker, NotificationDropdown, PushNotificationPrompt. Pattern: remove `emoji` property from option arrays, replace decorative emojis with styled number badges or allowed alternatives, conditional rendering for empty emoji strings.
- **Task agent reliability lesson:** General-purpose task agents sometimes compress multi-line code into single lines AND leave emoji content unchanged despite reporting success. Always verify with targeted grep after agent changes. Multiple passes were needed for SettingsPage and several components.
- Type check: `cd client && npx tsc --noEmit` passes clean after all changes.

### Phase 3: State-Aware Progressive Dashboard (2026-07)
- **Created `client/src/lib/userStage.ts`:** Utility with `UserStage` type union and `getUserStage()` function. 6 stages: `no-calendar`, `no-friends`, `pending-invite`, `one-friend`, `has-hangouts`, `active-user`. Pure function — takes counts/booleans, returns stage string.
- **DashboardPage rewritten from 1341 lines → ~370 lines.** Removed: HowItWorks, calendar view remnants, activity feed, event suggestions, saved events, hangout history/log form, all calendar-related helpers, ACTIVITY_OPTIONS/DURATION_OPTIONS/TIME_OPTIONS/CANCEL_REASONS, mark-busy state, log form state (10+ useState vars), share/cancel/didnt-happen meetup mutations. Kept: dashboard + friends + meetups queries, friend action mutation (for accepting pending invites), AddToCalendarModal.
- **Each stage is its own component:** `StageNoCalendar`, `StageNoFriends`, `StagePendingInvite`, `StageOneFriend`, `StageHasHangouts`, `StageActiveUser`. All use centered layout with generous whitespace for single-CTA stages, list layout for content-rich stages.
- **Data derivation:** `acceptedFriends` from friendsData (status=accepted), `pendingInbound` (status=pending && invitedBy=friend.id), `upcoming` (future non-cancelled meetups), `completedHangouts` (past confirmed meetups). Stage is computed via `getUserStage()` in a useMemo.
- **Greeting only shown for has-hangouts/active-user stages.** Early stages use the full viewport for their single message + CTA.
- **ShareInviteButton** reusable component with 'secondary' and 'subtle' variants. Uses Web Share API with clipboard fallback.
- **Typography follows Ty Lee's hierarchy:** text-xl font-semibold for page titles, text-sm text-gray-500 for descriptions, standard gradient-btn for CTAs, text-xs text-gray-400 for metadata.
- **Emoji policy maintained:** Only ❤️ and ✅/⏳ used (allowed set).
- Type check: `cd client && npx tsc --noEmit` passes clean.

### Phase 4: Scheduling UX Improvements (2026-07)
- **Single-suggestion scheduling (FriendAvailability.tsx):** Added `completedHangouts` prop (default 0). When 0, renders single-suggestion mode: top slot shown prominently ("How about Saturday at 2pm?") with "Book it" CTA, collapsed "Other times that work ↓" expander showing up to 4 alternates. When >= 1, renders existing full list. FriendsPage now fetches meetups query to derive `completedHangouts` count and passes it down. `showOtherTimes` boolean state toggles the expand.
- **Star rating for hangout logging (StarRating.tsx + DashboardPage):** New `StarRating` component with 5 tappable SVG stars (44px hit targets), fill-left-to-right UX, Submit + Skip buttons. DashboardPage renders it as a card above stage content for the most recent unrated completed meetup. Rating submits to `POST /meetup-logs` with rating + friend name + date. Dismissed/rated meetup IDs tracked in localStorage (`slotted_rated_meetups`) to avoid re-prompting.
- **Social Battery gated behind milestone (SettingsPage):** Entire Social Battery section (frequency, no-plans days, social goal) wrapped in `{completedHangoutCount >= 3 && ...}`. SettingsPage now fetches meetups query to derive count. Default for new users remains "2-3-week" (existing useState default) — the section simply doesn't appear until the threshold is met.
- Type check: `cd client && npx tsc --noEmit` passes clean.

### Settings Cleanup & Sign Out to Header (2026-07)
- **Removed from SettingsPage:** Account section (profile image, display name editing, email, sign out button), Event Interests section (theater/concerts/sports/etc. tags + default city input), Default hangout length selector (30–60 min, 1–2 hrs, 2–4 hrs, 4+ hrs), Default call length selector (10–20 min, 30–60 min, 1–2 hrs, I don't do calls).
- **Dead state cleaned up:** `preferredDuration`, `preferredCallDuration`, `eventInterests`, `eventCity`, `displayName`, `editingName`, `nameBeforeEdit` — all state vars, useEffect hydration lines, and mutation payload fields removed.
- **Sign Out moved to AppShell header:** Profile avatar in top-right is now a dropdown button (was a direct Link to /settings). Dropdown contains "Settings" link with gear icon and "Sign out" button with door icon, separated by a divider. Invisible backdrop closes dropdown on outside tap. Works on mobile and desktop.
- **SettingsPage is now 2 sections:** Calendar (section 1) → Advanced accordion (section 2), plus Feedback at the bottom.
- **Mobile bottom nav updated:** Added gear icon (⚙️) as 3rd tab to AppShell. Mobile nav now displays: Friends, Dashboard, Settings. Desktop nav unchanged (4-item).
- **Notifications panel fixed on mobile:** Changed NotificationsPanel positioning from `fixed bottom-0` to `fixed top-14 bottom-0` to account for AppShell header (~56px) and ensure panel is visible.
- **Team review passed:** Suki (Designer) confirmed no sparse whitespace, avatar a11y valid. Ty Lee (UI Designer) recommended pending polish (auto-save, flatten accordion, extract feedback, destructive sign out styling). Mai (Product Strategist) confirmed all removals safe, recommended future learning of durations from meetup logs.
- Orchestration logs: `.squad/orchestration-log/2026-03-05T19:57:27Z-suki-settings-review.md`, `.squad/orchestration-log/2026-03-05T19:57:27Z-ty-lee-visual-design.md`, `.squad/orchestration-log/2026-03-05T19:57:27Z-mai-product-strategy.md`, `.squad/orchestration-log/2026-03-05T19:57:27Z-katara-mobile-nav.md`, `.squad/orchestration-log/2026-03-05T19:57:27Z-katara-mobile-notifications.md`. Decision merged to `.squad/decisions.md`.
- Type check: `cd client && npx tsc --noEmit` passes clean.

### First-Name-Only Display Names (2026-07)
- Created `client/src/lib/utils.ts` with `getFirstName(displayName)` utility — splits on space, returns first token, handles null/undefined/empty gracefully.
- Applied `getFirstName()` across 10 files: DashboardPage, FriendsPage, InvitePage, EventSharePage, OnboardingPage, NotificationsPage, NotificationDropdown, FriendAvailability, GroupAvailability, AppShell (avatar initial unchanged — already single char).
- Replaced all inline `.split(' ')[0]` patterns with the centralized utility.
- Display-layer only: DB values, API responses, and meetup-log payloads (`friend_name`) still use full names.
- Type check: `cd client && npx tsc --noEmit` passes clean.

### Duplicate First Name Disambiguation (2026-07)
- Created `getSmartDisplayName(displayName, allNames)` in `client/src/lib/utils.ts` alongside existing `getFirstName()`. When multiple people share a first name, appends last initial (e.g. "Mike S.", "Mike J."). Unique first names still show just the first name. Handles nulls, single-word names, and empty arrays gracefully.
- Applied in **FriendsPage**: computed `allFriendNames` via `useMemo` from `friends` array. All 5 friend-name render sites updated (accepted list row, incoming invites, outgoing invites, remove confirmation modal).
- Applied in **DashboardPage**: computed `allFriendNames` via `useMemo` from `friendsData`. Threaded as prop to `StagePendingInvite`, `StageOneFriend`, `StageHasHangouts`, `StageActiveUser`. Updated meetup title generation (participant names), `friendsToSee` avatar labels, and `ratingFriendName`. Greeting line (`"Hi, Mike"`) kept as `getFirstName` since it's the current user — no disambiguation needed.
- Applied in **FriendAvailability**: added optional `allFriendNames` prop. Used for `friendFirst` display and header/confirmation text. Passed from FriendsPage.
- Applied in **GroupAvailability**: added optional `allFriendNames` prop. Falls back to `friendNames` (group participants) if not provided.
- Applied in **NotificationDropdown** and **NotificationsPage**: added `fetchFriends` query (React Query caches it — no extra network call if already fetched by another page). Used `getSmartDisplayName` for counter-propose `friendName`.
- **Not changed**: InvitePage, EventSharePage, OnboardingPage — these show a single person in isolation where disambiguation isn't meaningful.
- `getFirstName` retained for current-user greeting and FriendAvailability's "Me" label. Unused imports cleaned up.
- Type check: `cd client && npx tsc --noEmit` passes clean.

## Learnings

### Calendar Selection UX Research (2026-07)
- **Problem identified:** FriendsPage multi-select mode for friends lacks clear visual indicators. Users don't understand they're in selection mode because: (1) long-press entry is non-discoverable, (2) visual state is subtle (light background + small checkmark badge on avatar), (3) no checkboxes (users expect them for multi-select).
- **Current pattern:** `selectMode` boolean state + `selectedIds` Set. Long-press (500ms) or right-click activates mode. Tapping toggles selection. Selected rows get `bg-slotted-50/60` background + 16×16px checkmark badge positioned on avatar bottom-right. "Select" button in header (text-only, easy to miss). Floating action button appears when >= 2 selected.
- **CalendarPicker pattern:** The `CalendarPicker` component (used in Settings) implements standard checkbox list pattern with explicit checkboxes, selection count ("X of Y selected"), and quick actions ("Select all" / "None"). This creates inconsistency — users may expect the same pattern for friend selection.
- **Recommendation:** Add checkboxes when in select mode (matches CalendarPicker pattern, universal multi-select affordance). Enhance visual state (darker background, maybe left border). Add selection count at top. Make "Select" button more prominent. Hybrid approach (checkboxes + visual state) is strongest.
- **Files:** `client/src/pages/FriendsPage.tsx` (lines 29-31 state, 150-155 long-press, 203-221 render with visual state, 246-251 header button, 394-406 floating action). `client/src/components/CalendarPicker.tsx` (lines 148-176 checkbox pattern, 245-255 count + quick actions).
- **Edge cases:** Single friend (can't select), selection persistence on mode exit (currently clears), keyboard nav (none), screen reader support (no ARIA labels).
- Research document: `.squad/agents/katara/research-calendar-selection-ux.md`

### Feedback UI Location Research (2025-05-XX)
- **Current state:** Feedback form is embedded in SettingsPage.tsx (lines 562-578) as the last section on the page. Includes textarea, send button, user email display, and success state ("Sent! Thank you ✓").
- **Backend:** `POST /feedback` with `{ message: string }` via `feedbackMutation` (useMutation).
- **Existing patterns:** AddToCalendarModal uses fixed overlay + centered card modal pattern (`fixed inset-0 z-50 flex items-center bg-black/40 backdrop-blur-sm`). NotificationDropdown uses absolute positioned dropdown from header. No existing FABs in codebase.
- **Recommendation:** Extract to floating action button (FAB) in bottom-right corner, managed by AppShell. Click opens modal (reuse AddToCalendarModal pattern). Icon: chat bubble (friendly, conversational). Positioning: mobile `fixed bottom-20 right-4 z-40` (above tab bar), desktop `fixed bottom-6 right-6 z-40`.
- **Implementation plan:** Create FeedbackModal.tsx component, add FAB to AppShell.tsx, remove feedback section from SettingsPage.tsx.
- **Research doc:** `.squad/agents/katara/feedback-extraction-research.md`
