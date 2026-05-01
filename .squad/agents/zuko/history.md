# Zuko — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** Firebase Functions + Express + TS (functions/), Supabase PostgreSQL (database/schema.sql), Firebase Auth
- **Backend structure:** routes in functions/src/index.ts, Supabase client in functions/src/supabase.ts, migrations in migrations/

## Learnings

<!-- Append learnings below -->

### Critical Security Audit Completed (2026-04-30)

Fixed 4 critical backend vulnerabilities from full audit:

1. **Admin Secret Hardcoding** — Removed hardcoded fallback `"slotted-admin-2026"` from `requireAdmin`. Admin endpoints now fail closed (403) unless `ADMIN_SECRET` env var is explicitly set. Deployment must configure this env var explicitly.

2. **Outlook Tokens Leakage** — Added `outlook_access_token`, `outlook_refresh_token`, `outlook_token_expires_at` to `SENSITIVE_FIELDS`. These tokens are now stripped from all user responses before sending to client. No impact on existing clients — fields were never intentionally exposed.

3. **Friends Email Disclosure** — Removed `email` field from GET `/friends` response. Friends now see: `id`, `displayName`, `photoUrl`, `neighborhood`, `timezone`, `calendarConnected`, `eventInterests`. Backward-compatible change.

4. **Social Battery Leakage** — Removed `socialBattery` from GET `/friends` and GET `/dashboard` friend queries. Social battery remains visible only to user themselves via `/profile`. Frontend dashboard/friends cards must remove references to this field.

**Build Status:** `npm run build` ✅ passes. All changes backward-compatible. Deploy-ready pending frontend verification.

**Frontend Dependencies:** Katara verified friends list and dashboard don't expect `email` or `socialBattery` fields.

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


### Security Audit Fixes (Critical) — $(date +%Y-%m-%d)
- Removed hardcoded admin secret fallback `"slotted-admin-2026"` — now fails closed if env var missing
- Added `outlook_access_token`, `outlook_refresh_token`, `outlook_token_expires_at` to SENSITIVE_FIELDS
- Stripped `email` and `socialBattery` from GET /friends response (prevents email harvesting + battery leakage)
- Removed `social_battery` from dashboard friend query select + response mapping
- The `requireAdmin` middleware now rejects all requests when ADMIN_SECRET env var is unset (fail-closed)
- Build verified passing with esbuild after all changes

### Remaining Audit Fixes Delivered (2026-05-01)

Completed 3 of 4 remaining security audit fixes + architecture decisions received:

**Backend Code Fixes:**
1. **Account Deletion** — Implemented DELETE CASCADE from `users` table to all referencing tables. Migration: `database/migrations/add_user_delete_cascade.sql`
2. **OAuth HMAC** — Implemented HMAC validation on OAuth callback handlers for Google, Outlook, Apple. Prevents token interception via callback signature verification against provider secrets. Updated in `functions/src/index.ts`
3. **Friendship Cooldown** — Implemented 30-day cooldown between friendship deletion and re-friendship. Added `unfriended_at` timestamp; queries validate `NOW() - unfriended_at > 30 days` before allowing new friendship. Migration: `database/migrations/add_friendship_cooldown.sql`

**npm Audit Status:**
- Completed full audit sweep; 11 moderate/low vulnerabilities remain in uuid transitive dependencies
- These are unfixable without breaking changes — upstream uuid and dependencies have no available patches
- Documented in coordination notes; no further action possible without major version bumps

**Architecture Decisions from Toph (Ready for Implementation):**
- **Decision 3 (Quick Win):** Meetup race condition → AFTER UPDATE trigger with FOR UPDATE lock (0.5 day)
- **Decision 1 (Defense):** RLS policies on all 18 tables (1-2 days)
- **Decision 2 (Critical):** OAuth tokens → Supabase Vault with `oauth_tokens` table (2-3 days)
- Implementation order: 3 → 1 → 2
- Full specs in `.squad/decisions.md`

**Build Status:** ✅ All changes passing. Ready for migration deployment.

**Cross-Agent Coordination:**
- Katara completed npm audit fix (16 → 0 vulnerabilities) via serialize-javascript override
- Toph finalized 3 architecture decisions with full implementation specs
- Orchestration logs: `.squad/orchestration-log/2026-05-01T16:26:49Z-*.md`

### Functional Bug Fixes (Sokka Audit) — 2026-05-XX

Fixed 7 functional bugs identified during Sokka's flow testing audit:

1. **Route alias** — Added `POST /availability/group-overlap` forwarding to `/availability/multi-friend-overlap`. Both routes now work.
2. **Cross friend-request deadlock** — Before creating a pending friendship, checks if the other user already has a pending invite TO current user. If so, auto-accepts both and notifies both parties.
3. **Past-time validation** — Meetup creation rejects start times less than 5 minutes from now (400).
4. **endTime < startTime** — Both meetup creation and counter-propose endpoints validate endTime > startTime (400).
5. **Counter-propose orphan** — Original meetup status set to `"counter_proposed"` when a counter-proposal is created.
6. **Calendar sync upsert** — Replaced destructive delete-then-insert with upsert pattern + stale record cleanup. No zero-availability window.
7. **Notification dedup types** — Counter-propose notifications now use `"meetup_counter_proposed"`, declines use `"meetup_declined"`. Filter logic updated to include new types.

**Build Status:** ✅ `npm run build` passes clean.
