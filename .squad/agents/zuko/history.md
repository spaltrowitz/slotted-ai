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

### Event Search Waterfall Strategy
- **Problem:** Querying both Ticketmaster and SeatGeek in parallel caused cross-platform duplicates (same show appearing twice from different sources). The dedup logic was complex and imperfect (venue name mismatches, timezone handling).
- **Fix:** Replaced parallel query + dedup with a waterfall: Ticketmaster first → if 0 results → SeatGeek fallback. Only one ticketing platform is ever queried per search.
- **New helper:** `searchTicketedEvents()` — encapsulates the waterfall logic, used by all 5 event endpoints.
- **Endpoints updated:** `/events/search`, `/events/match`, `/events/discover`, `/events/suggest`, smart suggestions engine.
- **Dedup utility retained:** `deduplicateEvents()` kept in codebase for future use (still used in `/events/discover` to dedup across multiple interest-based queries that may return the same event from the same platform).
- Deployed successfully. All functions updated.

### Event-Anchored Group Scheduling Endpoint
- **New endpoint:** `POST /events/schedule` — searches for an event and annotates each showtime with per-person availability from Google Calendar.
- **Request:** `{ query, friendIds, location?, dateRange?: { start, end } }`
- **Response:** `{ event: { title, venue, city, type, imageUrl }, showtimes: [...], totalShowtimes, participants }`
- **Each showtime includes:** `{ datetime, available, allFree, conflicts: [{ name, reason }], ticketUrl, price: { min, max } }`
- **Buffer logic:** 1hr pre-show + 2.5hr default show duration + 30min post-show. A person must be free for the entire 4-hour window.
- **Privacy:** Only exposes free/busy status and conflict reason ("busy" or "calendar not connected"). Never leaks calendar event details.
- **Reuses:** `searchTicketedEvents()` (Ticketmaster-first waterfall), `getAcceptedFriendIdSet()`, `syncUserCalendar()`, `strictCalendarCheck()`, `getDbUserById()`, `applyTravelBuffer()`.
- **Edge cases handled:** friend without calendar → "calendar not connected" (not "busy"); date-only events → `dateOnly: true`, availability skipped; invalid datetime → skipped silently.
- **Sorting:** Available showtimes first, then by date. Date-only events last.
- Build verified ✅, deployed successfully to `https://api-xwsmuazwmq-uc.a.run.app`.

### Event-Anchored Friend Invite Links
- **New table:** `friend_invites` — stores shareable invite tokens linking a non-user to a specific event scheduling poll.
- **New endpoints:**
  - `POST /events/friend-invite` (auth required) — generates a URL-safe token (base64url, 32 bytes) with configurable expiry (default 30 days). Returns `inviteUrl` for sharing.
  - `GET /events/friend-invite/:token` (NO auth) — validates the invite and returns event title, inviter first name, group member first names. Powers the landing page before signup.
  - `POST /events/friend-invite/:token/accept` (auth required) — marks invite accepted, auto-creates "accepted" friendships (invitee ↔ inviter + all group members using the referral pattern: upsert with `status: "accepted"`), notifies inviter, triggers calendar sync for new member.
- **Key patterns reused:** `randomBytes` for token gen, `getAcceptedFriendIdSet` not needed (we create friendships directly), `syncUserCalendar` for post-accept calendar sync, `createNotification` for inviter notification, canonical UUID ordering for friendships.
- **RLS:** SELECT open for token validation (unauthenticated landing page), INSERT restricted to inviter, UPDATE restricted to inviter/accepter. Service role bypasses.
- **Migration:** `migrations/add_friend_invites.sql` — must be run manually in Supabase SQL Editor before the endpoints work.
- Build verified ✅, deployed to `https://api-xwsmuazwmq-uc.a.run.app`.

### Event Schedule Availability Fix (⏳ bug)
- **Problem:** All users showed ⏳ (checking) in the scheduling UI because calendar connectivity was detected via `strictCalendarCheck()` — which requires recent busy blocks in the DB. Users with connected but empty calendars appeared as "not connected". The requesting user's own calendar was never checked for connectivity at all.
- **Root cause 1:** `strictCalendarCheck` checks for recent `availability` rows with `status: "busy"`, not OAuth token presence. Empty calendar = false negative.
- **Root cause 2:** Requesting user (index 0) skipped the connectivity check entirely — if sync failed, they just appeared "busy" with no explanation.
- **Root cause 3:** `Promise.allSettled` swallowed sync failures silently. No "calendar_error" status was ever returned.
- **Fix:** Replaced `strictCalendarCheck` with direct OAuth token presence check (`google_refresh_token`, `outlook_refresh_token`, `apple_caldav_*`). Added connectivity check for requesting user. Track sync results per-user and return `"calendar_error"` when sync fails and no cached data exists.
- **Response now contains:** `"calendar_not_connected"` (no OAuth tokens), `"calendar_error"` (sync failed, no cached data), `"busy"` (confirmed conflict), or user appears in `allFree`.
- Build verified ✅, deployed successfully.

### Event Schedule "Everyone Busy" Fix (freeBusy rewrite)
- **Problem:** ALL users showed as "has plans" for EVERY showtime of Becky Shaw (46 showtimes over 6 weeks). Nobody was actually busy for all of them.
- **Root cause 1:** Availability was checked by querying pre-computed "free" slots from the `availability` table. Free slots are generated with a 9pm cap (user timezone). Evening shows (7pm+) need the 4-hour window to extend past 9pm (to 10pm+), so the containment check `slotEnd >= windowEnd` always failed.
- **Root cause 2:** `SYNC_WINDOW_DAYS = 14` — shows beyond 2 weeks had zero availability rows, so everyone appeared busy for weeks 3–6.
- **Root cause 3:** When no free slot was found (due to above), the code defaulted to "busy" instead of "unknown."
- **Fix:** Replaced the pre-computed availability table lookup with **direct Google Calendar freeBusy API calls** per user per showtime window. The freeBusy API returns actual busy blocks for any time range (no 14-day or 9pm limitation). If the API call fails or returns errors, the user gets `"calendar_check_failed"` (not "busy").
- **Key change:** No longer calls `syncUserCalendar()` from this endpoint (was unnecessary overhead — the freeBusy API gives real-time answers). Retained OAuth token presence check for connectivity.
- **Response reasons:** `"calendar_not_connected"` (no tokens), `"calendar_check_failed"` (API error or auth failure), `"busy"` (confirmed conflict from freeBusy).
- Build verified ✅, deployed to `https://api-xwsmuazwmq-uc.a.run.app`.

### Event Schedule Multi-Calendar Fix (Apple + Outlook)
- **Problem:** `POST /events/schedule` only checked Google Calendar freeBusy API. Users with Apple Calendar (CalDAV) connected had their Apple events ignored — showing them as "free" when they actually had conflicts.
- **Root cause:** The freeBusy loop called only `google.calendar.freebusy.query()`. If a user had Apple Calendar as their only or additional source, those events were invisible.
- **Fix:** After the Google freeBusy check, added Apple Calendar (CalDAV) and Outlook Calendar checks:
  - Apple: Queries `user_calendars` for selected Apple calendars, calls existing `fetchAppleBusyBlocks()` helper with the showtime window.
  - Outlook: Queries `user_calendars` for selected Outlook calendars, calls Microsoft Graph `calendarView` API.
  - A user is "busy" if ANY connected source has a conflict (short-circuit: stops checking once busy is confirmed).
  - Removed the hard gate that required a Google Calendar client — users with only Apple/Outlook calendars now work correctly.
- **Reused:** `fetchAppleBusyBlocks()` (existing CalDAV helper), `getOutlookGraphClient()` (existing MSAL helper), `user_calendars` table with `source` + `is_selected` filtering.
- Build verified ✅, deployed to `https://api-xwsmuazwmq-uc.a.run.app`.

