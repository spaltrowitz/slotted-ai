# Katara — History

## Key Patterns & Corrections

### Security Fixes (Critical)
1. **Hardcoded developer email removed** from AuthContext referral fallback. Referral attribution now only works with explicit `?ref=` param.
2. **Credential logging removed** from AuthContext (Apple Calendar username, API response), usePushNotifications (FCM token), firebase-messaging-sw.js (push payload). Browser extensions can harvest logged credentials.
3. **Firebase SW config hardening:** Replaced dummy keys with `__FIREBASE_*__` placeholders. New `firebaseSwEnvPlugin()` in vite.config.ts replaces at build time. Push notifications require: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.

### Functional Bug Fixes (Sokka Audit)
1. **Group scheduling endpoint:** Changed `POST /availability/group-overlap` → `/multi-friend-overlap` in GroupAvailability.tsx.
2. **Notification timestamps:** `timeAgo()` normalizes server timestamps lacking timezone suffix (append 'Z' for UTC).
3. **Meetup past-time validation:** Client-side validation in FriendAvailability, GroupAvailability, CounterProposePanel preventing past times and ensuring endTime > startTime.
4. **DST-safe timezone display:** Verified — app uses `toLocaleString()`/`Intl.DateTimeFormat` which handle DST correctly.

### NPM Vulnerability Audit
- Resolved all 16 vulnerabilities (5 moderate, 10 high, 1 critical → 0).
- `npm audit fix` resolved 12 (axios SSRF, protobufjs RCE, vite path traversal, rollup, flatted, lodash, etc.)
- `npm override` for `serialize-javascript>=7.0.5` resolved remaining 4 in `vite-plugin-pwa → workbox-build` chain.
- **Action item:** Monitor vite-plugin-pwa releases; remove override when upstream fixes.

### Security Audit Findings
- **High:** Open redirect in OAuth flows (`window.location.href = data.url` trusts server). Direct fetch() bypasses token interceptor.
- **Accessibility gaps:** StarRating (no ARIA/keyboard), AddToCalendarModal (no dialog role/focus trap), CalendarPicker (checkboxes lack labels), FriendsPage (role="button" missing Space key).
- **TypeScript debt:** 12+ `err: any` in catch blocks → should be `AxiosError` or `Error`.
- **Verified safe:** Fresh `getIdToken()` per request ✅, no `dangerouslySetInnerHTML` ✅, ProtectedRoute guards ✅, Bearer auth CSRF-resistant ✅, lazy-loaded routes ✅, soft social language ✅.

## Cross-Project Frontend Knowledge (injected 2026-05-02)

### From EatDiscounted (Hockney)
- **SSE streaming:** AbortController on ReadableStream. Abort-on-new-search, 30s timeout, cleanup on unmount.
- **Accessibility:** `aria-label` on inputs, `aria-live="polite"` + `role="status"` + `aria-busy`, `aria-current="page"`, `sr-only` (built into Tailwind v4).
- **Error vs empty state:** Distinct states. 429 → rate-limit message.
- **Premium design:** 2px borders, hover shadows + scale transforms, not-found at 60% opacity.
- **React 19 lint:** `Promise.resolve().then()` microtask for transitive setState.

### From MyDailyWin (Mipha, Urbosa, Alumni)
- **XSS:** `escapeHtml()` for text, `data-*` + `addEventListener()` for onclick. innerHTML loop: array.push() + join('').
- **Modal accessibility:** `<button>` with `aria-label`, `role="dialog"` + `aria-modal="true"`.
- **Storage key pattern:** Dual-write, canonical suffix. Divergent codebases → consolidation.
- **ARIA tabs:** tablist/tab/tabpanel with aria-selected. Scrollable tab strip, `overflow-x: auto` tables.
- **localStorage:** All JSON.parse in try/catch. Dark mode via CSS variables + `data-theme`. Responsive: 375/768/1024px, 44px targets.

### From Scrunch (Frenchy)
- **Component decomposition:** Extract, `React.memo`, stable props. "Show More" pagination.
- **Toast system:** `ToastProvider` + `useToast()`. Wire all mutations.
- **setState-in-effect → render-time sync.** `useMemo` for dependency stability.
- **React Query placeholderData** for instant navigation. Auth loading: never return null.
- **Mobile:** 44px targets, grid-based rating buttons. Legal TikTok: text-only with links.

### From HealthStitch (Kaylee)
- **CSS design system:** Custom properties, skeleton loaders, sync freshness indicator.
- **VITE_API_URL:** Single client module for all API calls. `fetchStatus` wrapper swallows errors → null.

## Session Archive Summary

Katara completed 5 sessions: critical security fixes (hardcoded email, credential logging, Firebase SW build-time substitution), 4 functional bug fixes from Sokka's audit (endpoint, timezone, past-time validation, DST verification), npm vulnerability audit (16→0 via audit fix + override), full security audit participation (3 critical + 3 high findings), and cross-agent coordination on friends/dashboard response changes. All changes TypeScript-verified.

## Learnings

- **FriendsPage dual-state bug:** `selectedFriendId` (single-friend view) and `groupFriendIds` (group view) are independent state. When transitioning between views, BOTH must be managed — clear the other when activating one. Render guards alone aren't sufficient; state cleanup on transitions prevents stale views from reappearing if the guard condition changes later.

- **Feedback Widget Redesign (Scrunch-style):** Replaced simple textarea modal with full category-based feedback flow: 🐛 Bug / 💡 Idea / 💜 Love it selector, category-specific placeholders and helper text, summary + details inputs, accessible modal with focus trap + escape-to-close + aria-modal, mobile-friendly (full-width on small screens). Backend enhanced to create GitHub issues with proper labels (feedback + category) via GitHub REST API when GITHUB_TOKEN env var is set. Deployed successfully.

- **Event-Anchored Scheduling UI:** Built 4 new components (EventScheduleButton, EventSearchModal, EventShowtimesPoll, EventShowtimeCard) implementing a poll-style event scheduling flow. Entry points on FriendsPage (shows when 1+ friends selected in multi-select mode) and DashboardPage (in StageHasHangouts and StageActiveUser sections). Search modal with friend selector chips, loading/error states, results view with sorted showtime cards featuring availability badges, vote buttons, and ticket links. Soft social language used throughout (⚠️ neutral for unconfirmed, not ❌). Consumes `POST /events/schedule` API. Deployed to production.

- **Event Invite Landing Page + Share Flow:** Built 3 new components (InviteFriendButton, InviteFriendModal, EventInviteLandingPage) implementing the full invite-a-friend flow for event scheduling. The InviteFriendButton lives on EventShowtimesPoll; the modal generates a shareable link with copy/text/email/native-share options. The landing page (`/event-invite/:token`) works without auth — shows event hero card with social proof, then triggers Google sign-in on CTA click, followed by calendar connect prompt. After acceptance, redirects to the poll. Route added as public (no ProtectedRoute wrapper). Mobile-first, uses existing design tokens and gradient patterns. API contract: `POST /events/invite`, `GET /events/invite/:token`, `POST /events/invite/:token/accept` (Zuko to implement). Deployed to production.

- **FriendsPage popup dismiss lag fix:** `setSearchParams({})` in `handleCloseFindTimes` triggered a synchronous React Router navigation, blocking the render that unmounts FriendAvailability. Fix: wrap `setSearchParams` in `startTransition` (low-priority update) with `{ replace: true }` (avoids pushing history). The high-priority state clear (`setSelectedFriendId(null)`) now renders instantly without waiting for the URL cleanup. Key insight: React Router's `setSearchParams` is NOT batched with regular setState — it goes through the router's navigation system, creating a separate render cycle that blocks the UI.

- **Event Poll UX Rework:** Replaced individual "This works for me" buttons with multi-select poll flow. EventShowtimeCard now uses checkboxes (aria-pressed buttons) instead of commit buttons. Calendar availability shown as hint badges (✅/❌/⚠️) that don't block selection. New EventPollBottomBar component provides sticky bottom bar with selection count and "Send to friends" button. EventShowtimesPoll manages multi-select state, shows submitted/waiting states with friend names. Calendar conflicts are informational only — users can override. Mobile-first layout with bottom-safe padding. Deployed to production.

- **Mobile Audit Fixes (Sokka):** Fixed 14/16 Critical+High mobile issues from Sokka's audit. Global CSS: added `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation`, and `.safe-bottom` utility class. Replaced `100vh`/`90vh` with `100dvh`/`85dvh` in 3 files. Added touch handlers (`onTouchStart`/`onTouchEnd`) to StarRating for tap-to-rate on mobile. Added `pb-[env(safe-area-inset-bottom)]` to NotificationDropdown, FriendsPage multi-select bar; `safe-bottom` class already applied to EventPollBottomBar (now defined). Bumped all `text-[9px]`→`text-[11px]` and `text-[10px]`→`text-xs` across 10+ files. Added `min-h-[44px]` to notification action buttons, CounterProposePanel close/suggest buttons, InviteFriendModal copy/done buttons, FeedbackButton close/category buttons, EventShowtimeCard ticket link. Created `useBodyScrollLock` hook and applied to all 4 modal components to prevent background scroll. Skipped: C5 (Firebase push needs real credentials), H9 (manifest screenshots need actual images). Deployed to production.

- **Event Search Typeahead + Link Fallback:** Reworked EventSearchModal from plain text input to typeahead autocomplete. Created `useDebounce` hook (300ms) and new `EventAutocomplete` component with: debounced API calls to `GET /events/autocomplete?q=`, dropdown with event title/venue/type badges (emoji per category), full keyboard navigation (up/down/enter/escape), `aria-combobox` accessibility, 44px min-height rows for mobile, loading spinner in input. Added link fallback below search ("Can't find your event? Paste a Ticketmaster or SeatGeek link") that reveals URL input calling `POST /events/from-url`. Removed all "Becky Shaw" hardcoded references. Selecting an autocomplete result immediately triggers schedule search. Both APIs pending Zuko's backend implementation. Deployed to production.
