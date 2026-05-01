# Decision: npm override for serialize-javascript

**Date:** 2025-07-25
**Author:** Katara (Frontend)
**Status:** Implemented

## Context
The `vite-plugin-pwa@1.2.0` → `workbox-build@7.4.0` → `@rollup/plugin-terser@0.4.4` → `serialize-javascript@6.0.2` chain has 4 high-severity vulnerabilities. No upstream fix is available yet (vite-plugin-pwa 1.2.0 is the latest).

## Decision
Added `"overrides": { "serialize-javascript": ">=7.0.5" }` to client/package.json to force the patched version.

## Trade-offs
- **Pro:** Eliminates all npm audit vulnerabilities immediately.
- **Con:** Override may need removal once upstream updates (monitor vite-plugin-pwa releases).
- **Risk:** Low — serialize-javascript 7.x is backward-compatible for this use case (build-time serialization in workbox).

## Action Items
- [ ] Remove override when vite-plugin-pwa ships with fixed transitive deps.
