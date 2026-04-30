# Katara — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** React 19 + TS + Tailwind v4 + Vite (client/), Firebase Functions + Express (functions/), Supabase PostgreSQL
- **Frontend structure:** components in client/src/components/, pages in client/src/pages/, API calls in client/src/lib/api.ts, contexts in client/src/contexts/

## Learnings

<!-- Append learnings below -->

### Security Audit (2026-04-30 — Full Team Audit)

**Scope:** Full end-to-end security, vulnerability, and quality audit (Toph, Zuko, Katara, Sokka)

**3 Critical findings affecting frontend:**
1. **Hardcoded developer email in `AuthContext.tsx:65`** — `localStorage.setItem('slotted_referrer_email', 'sharipaltrowitz@gmail.com')` — personal PII in production code. Remove immediately.
2. **Sensitive console logs leaking credentials** — Apple Calendar username (line 261), full API response (263), FCM tokens (usePushNotifications.ts:55), push payload (88), background message payload (firebase-messaging-sw.js:24)
3. **Firebase SW placeholder API keys** — `public/firebase-messaging-sw.js` has TODO placeholders. Push notifications non-functional in production until real keys injected via build step.

**3 High findings affecting frontend:**
1. **Open redirect in OAuth flows** — `AuthContext.tsx:236, 305` uses `window.location.href = data.url` trusting server response. Decision needed: whitelist allowed redirect domains (google.com, microsoft.com)?
2. **Direct fetch() bypasses token interceptor** — `AuthContext.tsx:122-140` uses raw fetch() instead of `api` client. Decision: standardize all API calls through `lib/api.ts`?
3. **FriendsPage performance** — `renderFriendRow` creates new handler functions per render (line 193-260). Decision: extract to React.memo component?

**Accessibility gaps (team awareness):**
- StarRating: no ARIA roles, no keyboard navigation, color-only feedback
- AddToCalendarModal: no `role="dialog"`, no focus trap
- CalendarPicker: checkboxes lack `<label>` elements
- FriendsPage: `role="button"` elements lack full keyboard support (only Enter, not Space)

**TypeScript `any` debt:**
- 12+ instances of `err: any` in catch blocks across AuthContext, CalendarPicker, GroupAvailability, FriendAvailability, CounterProposePanel
- Should be typed as `AxiosError` or `Error`

**Security verified safe (no action needed):**
- Auth tokens: Fresh `getIdToken()` per request via axios interceptor ✅
- No XSS: No `dangerouslySetInnerHTML` anywhere ✅
- Route protection: ProtectedRoute properly guards authenticated pages ✅
- CSRF: Bearer token auth inherently CSRF-resistant ✅
- Environment vars: Firebase config uses `VITE_` prefix correctly ✅
- PWA caching: NetworkOnly for auth endpoints ✅
- Code splitting: All routes lazy-loaded with retry logic ✅
- Soft social language verified across all user-facing copy ✅

**Cross-team findings affecting frontend:**
- **Zuko found OAuth CSRF:** Backend uses bare Firebase UID as `state` parameter. Frontend auth flows rely on server not being malicious.
- **Sokka found email harvesting:** Friend list response includes emails (backend issue, but affects frontend users' privacy expectations)
- **Toph found protobufjs RCE:** npm audit critical vulnerability (frontend dependency, needs update)

**Decisions written to:** `.squad/decisions.md` (all findings merged 2026-04-30)

### 2025-04-30 — Security Hotfix (Critical)
- **FIX 1:** Removed hardcoded developer email (`sharipaltrowitz@gmail.com`) from AuthContext referral logic. The else-branch was a dev shortcut and leaked PII.
- **FIX 2:** Removed 3 credential-logging console.log statements: Apple Calendar username/response in AuthContext, FCM token in usePushNotifications. Browser console should never show secrets.
- **FIX 3:** Replaced dummy Firebase config placeholders in `firebase-messaging-sw.js` with build-time substitution pattern (`__FIREBASE_*__` tokens). Added `firebaseSwEnvPlugin()` Vite plugin in `vite.config.ts` that injects `VITE_FIREBASE_*` env vars into the SW during production builds.
- TypeScript compiles clean after all changes.
