# Zuko — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** Firebase Functions + Express + TS (functions/), Supabase PostgreSQL (database/schema.sql), Firebase Auth
- **Backend structure:** routes in functions/src/index.ts, Supabase client in functions/src/supabase.ts, migrations in migrations/

## Learnings

<!-- Append learnings below -->

### Phase 1 Groups Backend Removal Completed (2026-03-05T18:22:54Z)
Phase 1 backend Groups removal completed successfully. Orchestration log: `.squad/orchestration-log/2026-03-05T18:22:54Z-agent-12-zuko.md`. Decision merged to `.squad/decisions.md`. Migration created (`migrations/remove_groups.sql`) but NOT executed — awaiting Toph's schema review. Cross-agent dependency: Katara's GroupAvailability.tsx must update API call to `/availability/multi-friend-overlap`. Build passes clean.

### Phase 1: Groups Backend Removal (2026-XX-XX)

**Removed (~434 lines net):**
- 5 group endpoints: GET /groups, POST /groups, PUT /groups/:id, POST /groups/:id/members, DELETE /groups/:id (lines 3344–3776 original)
- Group auto-join on signup: removed `friend_group_members` upsert from pending invite processing (~18 lines, around line 933)
- Removed `group_id` from `pending_invites` select in signup flow (line 888)
- Removed 4 group notification creation calls (added to group, removed from group, left group, joined group)
- Renamed route `/availability/group-overlap` → `/availability/multi-friend-overlap` (route + EXPENSIVE_PATHS constant)

**Kept:**
- `scoreGroupOverlaps()` helper function — still used by both 1-on-1 `scoreOverlaps()` and the multi-friend overlap endpoint. Name is internal-only.
- POST `/availability/multi-friend-overlap` endpoint — core multi-friend scheduling logic, just renamed.

**Dependencies found:**
- `group_id` column on `pending_invites` — referenced in signup auto-connect. Removed from backend code; migration file created but not executed.
- Line 5701 comment mentions `self_groups` — this refers to Meetup.com API, NOT Slotted groups. No change needed.
- No orphaned imports found (groups code only used standard helpers like `getDbUser`, `getSupabase`, `createNotification`, `getAcceptedFriendIdSet`).

**Migration created:** `migrations/remove_groups.sql` — drops `friend_group_members`, `friend_groups`, removes `group_id` from `pending_invites`, restores original unique constraint. NOT executed — awaiting Toph's review.

**Build status:** `npm run build` passes clean.

## Core Context (Summarized prior work)

### 2026-03-03 & Earlier: Critical Production Fixes

**Firebase deployment:** Functions live at https://api-xwsmuazwmq-uc.a.run.app. Fixed 3 critical bugs (feedback loop prevention via `rsvp_source` guards, disconnect cleanup orphaned channels, webhook must always return 200). Added CORS origin validation. Fixed HIGH-severity group meetup reschedule protection and 410 stale sync token retry logic. Added `DEFAULT_HANGOUT_WINDOWS` filter to restrict suggestions to Fri 5–11 PM, Sat 9 AM–11 PM, Sun 9 AM–5 PM.

**Notification deduplication:** Fixed unique index too broad (was blocking group membership notifications). Narrowed to `friend_request` only. Verified all `createNotification("friend_accepted")` call sites covered by cascading dedup (1hr relatedUserId → 5min relatedId → 10min title).

**Key patterns:** 
- Any Google webhook must return 200 for all requests (even errors) or Google deactivates the endpoint
- For stale sync tokens (410), clear and retry immediately in the same webhook call
- `friend_accepted` is overloaded (real acceptances + group add/remove) — future work should use `group_update` type
- Use Supabase `{ count: "exact", head: true }` for efficient count-only queries

---

### E2E Compatibility Sprint — Manual Busy Blocks + Backend API Normalization (2026-03-05)

**Summary:** Created manual busy blocks migration and normalized backend API to accept both camelCase and snake_case naming conventions across all endpoints. Build passes. 5 backend compatibility issues resolved.

**Deliverables:**

1. **Migration:** `migrations/add_manual_busy_blocks.sql` (UUID PK, user_id FK, start_time/end_time, reason, created_at, RLS policies)
2. **Backend Normalizations:**
   - POST /groups: Accept both `memberIds` and `member_ids`
   - GET /friends: Return `id` + `friendshipId` + raw DB fields (`user_a_id`, `user_b_id`, `invited_by`)
   - PATCH /friends/:id: Accept `{ status: "accepted" }` as alias for `{ action: "accept" }`
   - POST /meetups: Accept both camelCase (`friendIds`, `startTime`, `endTime`) and snake_case variants
   - POST /events/save: UUID field correctly saved and returned

**Build Status:** `npm run build` passes, no type errors.

**Impact:** Enables 12–16 of 16 remaining E2E test scenarios to pass once migration is applied in Supabase.

**Cross-Agent Synergy:** Sokka's test infrastructure fixes (polling, client normalizations) pair perfectly with these backend normalizations. Both delivered in parallel; they unlock each other.

---

## Security Audit (2026-03-06)

Full security review of `functions/src/index.ts` (~9,400 lines), `functions/src/supabase.ts`, and `database/schema.sql`.

### Critical Issues Found

| # | Severity | Issue | Location |
|---|----------|-------|----------|
| 1 | 🔴 CRITICAL | Admin secret hardcoded fallback (`"slotted-admin-2026"`) | index.ts:9337 |
| 2 | 🔴 CRITICAL | OAuth tokens stored plaintext in DB | schema.sql:43-58, index.ts:6649,6757,7244,7450 |
| 3 | 🟠 HIGH | OAuth callbacks use bare Firebase UID as `state` (CSRF) | index.ts:6744,7432 |
| 4 | 🟠 HIGH | Apple CalDAV password stored plaintext (iCloud app-specific password) | index.ts:7244 |
| 5 | 🟡 MEDIUM | In-memory rate limiter not distributed (per-instance counters) | index.ts:69-95 |
| 6 | 🟡 MEDIUM | `/suggestions/:friendId` doesn't verify friendship | index.ts:4372 |
| 7 | 🟡 MEDIUM | `getDbUser` fetches `select("*")` including token columns | index.ts:201 |

### Architecture Positives

- Firebase Auth applied consistently to all protected endpoints
- Friendship checks (IDOR protection) on social endpoints
- Parameterized queries via PostgREST (no SQL injection)
- RLS enabled on all tables (blocks direct Supabase client access)
- Webhook secret properly validated on Google Calendar webhooks
- Sensitive fields stripped from GET /users/me responses

### Learnings

- The entire backend is a single ~9,400-line Express app (`index.ts`). No route splitting or module organization.
- All DB queries use `service_role` key — RLS exists but is never enforced for the backend. Authorization is 100% application-level.
- Admin panel uses a shared secret (`x-admin-secret` header), not per-user admin auth.
- OAuth `state` parameter should be an HMAC-signed nonce, not a raw UID.
- The `stripSensitive()` helper (line 982) strips token fields from responses — applied to GET but NOT to POST /users/me or onboarding responses.

### Recommendations (Priority Order)

1. Remove hardcoded admin secret fallback — fail if env var missing
2. Encrypt OAuth tokens at rest (AES-256-GCM with a KMS-managed key)
3. Sign the OAuth `state` parameter with HMAC to prevent CSRF
4. Use Redis or Firestore for distributed rate limiting
5. Validate `friendId` param is an accepted friend in suggestions endpoint
6. Scope `getDbUser` to only select needed columns (not `*`)

