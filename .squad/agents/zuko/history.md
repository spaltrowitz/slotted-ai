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

## Security Audit (2026-04-30 — Full Team Audit)

Full-spectrum audit with Toph (architecture), Katara (frontend), and Sokka (testing). Findings merged to `.squad/decisions.md`.

### Critical Issues Found (Cross-Team)

| # | Severity | Issue | Found By | Related |
|---|----------|-------|----------|---------|
| 1 | 🔴 CRITICAL | Admin secret hardcoded fallback (`"slotted-admin-2026"`) | Zuko, Sokka | Toph aware |
| 2 | 🔴 CRITICAL | OAuth tokens stored plaintext in DB | Zuko, Toph | Sokka noted in memory |
| 3 | 🔴 CRITICAL | Outlook tokens NOT in SENSITIVE_FIELDS → leaked | Sokka | Zuko + Toph didn't catch |
| 4 | 🔴 CRITICAL | No account deletion endpoint (GDPR violation) | Sokka | New finding |
| 5 | 🔴 CRITICAL | Friend list includes all email addresses | Sokka | Privacy leak |
| 6 | 🟠 HIGH | OAuth callbacks use bare Firebase UID as `state` (CSRF) | Zuko | Needs signature/nonce |
| 7 | 🟠 HIGH | Apple CalDAV password stored plaintext | Zuko | Same encryption as #2 |
| 8 | 🟡 MEDIUM | In-memory rate limiter per-instance | Zuko, Sokka | Needs Redis/Firestore |

### Critical Issues (Zuko-specific findings)

- OAuth token encryption strategy needed (AES-256-GCM vs Vault vs KMS)
- `stripSensitive()` (line 982) missing Outlook fields — frontend sees all tokens
- `getDbUser()` uses `select("*")` including token columns — internal leak risk

### Frontend Cross-Link (Katara findings affecting backend)

- **Hardcoded email:** Also appears in Zuko's concerns (PII exposure)
- **OAuth open redirect:** `window.location.href = data.url` — relies on backend not being malicious
- **Direct fetch() bypass:** Client bypasses token refresh logic via raw fetch

### Test Coverage (Sokka findings)

- **Untested critical path:** OAuth token refresh/expiry (500+ lines)
- **Untested critical path:** Admin endpoints (zero coverage, hardcoded secret is the only barrier)
- **Untested critical path:** Concurrent operations (race condition on meetup confirm noted)
- **Recommendation:** Integration tests with mock Google API should be first priority

### Architecture Decisions Pending

1. Token encryption strategy (Supabase Vault vs app-layer vs KMS)
2. RLS policy strategy (define defensively now vs service-role-only intentional)
3. Share code format (UUID-based instead of 3-char)
4. Meetup confirm race condition (DB trigger vs atomic update)

