# Zuko — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** Firebase Functions + Express + TS (functions/), Supabase PostgreSQL (database/schema.sql), Firebase Auth
- **Backend structure:** routes in functions/src/index.ts, Supabase client in functions/src/supabase.ts, migrations in migrations/

## Learnings

<!-- Append learnings below -->

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

