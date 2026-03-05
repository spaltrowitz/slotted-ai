## Decision: Workbox PWA Asset Caching via vite-plugin-pwa (Katara, 2026-07)

| Field | Value |
|---|---|
| **Author** | Katara (Frontend Dev) |
| **Status** | Implemented |
| **Scope** | PWA offline caching, service worker architecture |

### Decision

Use `vite-plugin-pwa` with `generateSW` mode and `importScripts` to add Workbox-based asset caching while coexisting with the existing Firebase Messaging service worker.

### Key Choices

1. **`generateSW` over `injectManifest`** — simpler config, no custom SW file to maintain. Workbox generates the entire SW from `vite.config.ts` options.
2. **`importScripts('./firebase-messaging-sw.js')`** — the generated `sw.js` imports Firebase messaging code. One SW handles both caching and push notifications.
3. **`serviceWorkerRegistration` passed to `getToken()`** — prevents Firebase from registering a second SW. Both systems share the Workbox-managed registration.
4. **`manifest: false`** — we already have `public/manifest.json`, no auto-generation needed.
5. **Route order matters** — NetworkOnly rules for auth/calendar endpoints are registered before the general `/api/` StaleWhileRevalidate rule.

### Caching Strategies

| Resource | Strategy | Config |
|----------|----------|--------|
| JS/CSS/HTML bundles | Precache (26 entries) | Auto from build output |
| Images/fonts/icons | CacheFirst | 100 entries, 30-day expiry |
| /api/* (non-calendar) | StaleWhileRevalidate | 50 entries, 5-min expiry |
| Firebase Auth endpoints | NetworkOnly | Always fresh |
| /api/calendar/* | NetworkOnly | Always fresh |
| Google Calendar API | NetworkOnly | Always fresh |
| Navigation requests | NetworkFirst | 3s timeout, cache fallback |

### Files Changed

- `client/vite.config.ts` — Added VitePWA plugin with full Workbox config
- `client/src/main.tsx` — Added `registerSW({ immediate: true })` for auto-update
- `client/src/vite-env.d.ts` — Added `vite-plugin-pwa/client` type reference
- `client/src/hooks/usePushNotifications.ts` — Pass Workbox SW registration to Firebase `getToken()`
- `client/package.json` — Added `vite-plugin-pwa` devDependency

### Build Output

- `build/sw.js` — Generated Workbox service worker
- `build/workbox-*.js` — Workbox runtime library
- `build/firebase-messaging-sw.js` — Copied from public/, imported by sw.js
