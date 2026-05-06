# Zuko — History

## Key Patterns & Corrections

### Security Fixes (Critical)
- **Admin secret:** Removed hardcoded fallback `"slotted-admin-2026"`. `requireAdmin` now fails closed (403) if env var unset.
- **Outlook tokens:** Added `outlook_access_token`, `outlook_refresh_token`, `outlook_token_expires_at` to `SENSITIVE_FIELDS`.
- **Friends privacy:** Removed `email` and `socialBattery` from GET `/friends` and `/dashboard` responses.
- **OAuth HMAC:** Implemented HMAC validation on OAuth callbacks (Google, Outlook, Apple) for token interception prevention.
- **Account deletion:** CASCADE from `users` + cancel meetups + notify participants + clear OAuth tokens from Vault + delete blocked_users + delete notifications.
- **Friendship cooldown:** 30-day cooldown via `unfriended_at` timestamp before re-friendship.
- **Block/mute:** `blocked_users` table with RLS, 3 endpoints (POST/DELETE /users/block/:userId, GET /users/blocked). Check on friend invite + meetup creation. Blocking removes existing friendship.

### OAuth Token Vault Encryption
- Created `oauth_tokens` table storing vault secret UUIDs per user+provider.
- JSON blob of sensitive fields (access_token, refresh_token, caldav_password) stored as Vault secrets.
- Non-sensitive metadata (token_expires_at, caldav_username) stored in plaintext.
- SQL helper functions (`upsert_oauth_tokens`, `get_oauth_tokens`, `clear_oauth_tokens`) are SECURITY DEFINER.
- `getDbUser()`/`getDbUserById()` overlay decrypted tokens — existing code works unchanged.
- Old columns renamed `_deprecated` (not dropped) for rollback safety.
- Vault secrets named `oauth:{user_id}:{provider}`.

### RLS & Race Condition Fixes
- **RLS policies:** Defensive policies on all 17 tables. `get_current_user_id()` SECURITY DEFINER maps `auth.uid()` → internal UUID. Separate policies per operation per table. Service_role bypasses.
- **Meetup acceptance trigger:** AFTER UPDATE trigger with FOR UPDATE lock on meetups. Atomically transitions to 'confirmed' when last participant accepts.

### Groups Removal
- Removed 5 group endpoints, group auto-join on signup, `group_id` from pending_invites select.
- Renamed `/availability/group-overlap` → `/availability/multi-friend-overlap`.
- Kept `scoreGroupOverlaps()` helper (still used) and multi-friend scheduling endpoint.
- Migration: `migrations/remove_groups.sql` (drops tables, restores constraints).

### Functional Bug Fixes (Sokka Audit)
- Route alias: `POST /availability/group-overlap` forwards to `/multi-friend-overlap`.
- Cross friend-request deadlock: Auto-accepts both if mutual pending invites exist.
- Past-time validation: Rejects start times <5 min from now (400).
- endTime > startTime validation on meetup creation and counter-propose.
- Counter-propose: Sets original meetup to `"counter_proposed"` status.
- Calendar sync: Replaced delete-then-insert with upsert + stale record cleanup.
- Notification dedup: Counter-propose uses `"meetup_counter_proposed"`, decline uses `"meetup_declined"`.
- Multi-person decline: Auto-cancels if all non-creator participants decline.
- Meetup expiry: `cleanupExpiredMeetups` scheduled function (daily 6am).
- Calendar nudge: Rate-limited notification (max 1/week per pair) when overlap returns 0 and friend lacks calendar.

### E2E Compatibility
- Backend accepts both camelCase and snake_case for all endpoints.
- Created `migrations/add_manual_busy_blocks.sql`.
- Duplicate meetup detection: Returns 409 with existing meetup ID.
- Deleted friend error: 410 "no longer on Slotted" vs 403 "must be accepted friends".

## Cross-Project Backend Knowledge (injected 2026-05-02)

### From EatDiscounted (Fenster)
- **Rate limiting:** Per-IP sliding window. 429 + `Retry-After`. Verify wired in.
- **In-memory caching:** TTL-based. Key: `entity::source`. Lost on deploy — needs Redis for serverless.
- **Security:** `.env.local` in `.gitignore`. Check git history. Rotate exposed keys.

### From MyDailyWin (Daruk, alumni)
- **Firebase Auth + Firestore ownership:** `ownerEmail` + admins subcollection. Never trust localStorage for authorization.
- **Firestore rules:** `request.auth != null` alone too permissive — need ownership scoping + field validation.
- **XSS via innerHTML:** 45+ instances. Always sanitize user-provided and OAuth-returned content.

### From Scrunch (Danny)
- **Supabase count-only:** `select('id', { count: 'exact', head: true })` for stats endpoints.
- **Loading gate anti-pattern:** Use `placeholderData` + `staleTime`. Render defaults immediately.
- **Search relevance:** Domain-aware extraction > generic NLP. Multi-query with dedup.

### From HealthStitch (Wash)
- **Sync architecture:** WHOOP = backend-pull, Apple Watch = iOS-push. Different strategies per source.
- **Metric normalization:** Never compare cross-source metrics directly. Separate baselines.
- **PostgreSQL migration:** `datetime('now')` → `NOW()`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`.

## Learnings

### Calendar Event Removal on Cancel/Decline
- Created `removeCalendarEvent(user, eventId)` helper — tries Google, Outlook, Apple in order; fails silently on 404/410/disconnected.
- Created `removeCalendarEventsForMeetup(meetupId, excludeUserId?)` — bulk removes for all participants with a `google_event_id`.
- Created `removeCalendarEventForParticipant(meetupId, userId)` — single-user removal for individual declines.
- Integrated into 5 code paths: 2-person decline (auto-cancel), 3+ person all-declined, 3+ person individual decline, manual cancel ("didn't happen"), account deletion (other participants only), and expired meetup cleanup.
- The `google_event_id` column on `meetup_participants` stores event IDs for ALL providers (Google, Outlook, Apple) — naming is legacy but functional.
- `getAuthedCalendarClient` requires `firebase_uid`, not the internal user `id`. Always pass via user record.

## Session Archive Summary

Zuko completed 10+ sessions: critical security audit fixes (admin secret, token leakage, email/socialBattery stripping), Groups backend removal (~434 lines), E2E compatibility sprint (API normalization, manual busy blocks migration), OAuth HMAC validation, account deletion with full CASCADE, friendship cooldown, block/mute feature, 7 functional bug fixes from Sokka's audit, 8 multi-user interaction bug fixes, meetup acceptance trigger (FOR UPDATE lock), defensive RLS policies (17 tables), and OAuth token Vault encryption (full migration with rollback safety). All changes build-verified.

### Event Dedup Redesign (Cross-Platform)
- **Problem:** Previous `deduplicateEvents()` merged ALL recurring shows at the same venue into one entry, losing individual showtimes needed for the `/events/match` availability-cross-reference feature. Also failed on venue names like "The Hayes Theater" vs "Helen Hayes Theatre".
- **Fix:** Redesigned dedup to match by title + datetime (±2hr tolerance). Each showtime stays separate. Only merges the SAME performance appearing on multiple platforms.
- **Key findings from "Becky Shaw" test:**
  - SeatGeek: "Becky Shaw - New York" at "The Hayes Theater", datetime_utc without trailing Z
  - Ticketmaster: "Becky Shaw" at "Helen Hayes Theatre", dateTime with trailing Z
  - Both have 46 identical showtimes, 100% overlap after normalizing Z suffix
- **New utilities:** `normalizeVenue()` (handles Theatre/Theater, "The" prefix), `venuesMatch()`, `parseEventTime()` (handles missing Z)
- **Title normalization enhanced:** Now strips city suffixes like " - New York" that SeatGeek appends
- **Matinee/evening safety:** 2hr tolerance ensures same-day matinee (2pm) and evening (7pm) remain separate
- Deployed successfully. All functions updated.
