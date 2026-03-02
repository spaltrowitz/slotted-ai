# Decision: CORS Hardening (QW-4)

**Author:** Zuko  
**Date:** 2025-07-22  
**Status:** Implemented  

## Context
The CORS middleware in `functions/src/index.ts` had a security hole: the fallback for unknown origins was `callback(null, true)`, allowing any domain to make authenticated API requests.

## Decision
Changed the else branch to `callback(new Error("Not allowed by CORS"))` so unknown origins are rejected with a CORS error.

## Allowed Origins (unchanged)
- `http://localhost:5173` — Vite dev server
- `http://localhost:5174` — Vite dev server (alternate port)
- `https://slotted-ai.web.app` — Firebase Hosting (production)
- `https://slotted-ai.firebaseapp.com` — Firebase Hosting (alternate)

## Trade-offs
- Requests with no `Origin` header (mobile apps, curl, server-to-server) are still allowed through — this is standard and intentional. Firebase Auth middleware is the real gatekeeper for those.
- If a staging domain is added later, it needs to be added to `allowedOrigins` or the request will be blocked.

## Files Changed
- `functions/src/index.ts` line 55 — one-line change
