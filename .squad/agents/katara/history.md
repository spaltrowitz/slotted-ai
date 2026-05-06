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
