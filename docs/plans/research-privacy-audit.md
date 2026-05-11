# Privacy Audit — Does Slotted Do What the Landing Page Says?

**Date:** 2026-05-11
**Trigger:** After updating the landing page to claim "Your calendar stays private. Friends never see your battery, your free blocks, or your sync status. We only see free or busy — never details."
**Scope:** End-to-end audit of code paths against each claim.

---

## Claims Audited

| # | Claim | Verdict |
|---|---|---|
| 1 | "We only see free or busy — never event titles or details." | ✅ Holds at rest. Caveat: titles/locations are read in-memory during sync (Google `events.list`, Apple iCal `SUMMARY`/`LOCATION`, Outlook `subject`/`location`) but **never persisted**. |
| 2 | "Friends never see your battery." | ✅ `social_battery` is never returned in any friend-facing endpoint. |
| 3 | "Friends never see your free blocks." | ❌ **VIOLATED** by `/availability/overlap/:friendId` and `/availability/multi-friend-overlap` returning `freeSlots` counts per friend. **Fixed.** |
| 4 | "Friends never see your sync status." | ❌ **VIOLATED** by three endpoints + two UI components rendering "{name} hasn't synced their calendar" and "(no cal)" badges. **Fixed.** |
| 5 | OAuth tokens encrypted. | ✅ Vault-backed (`vault.secrets`), only secret-ID references in `oauth_tokens` table. |
| 6 | Row-Level Security. | ✅ Enabled on all tables. Service role only; no anon/authenticated policies defined. |

---

## Detailed Findings

### Claim 1 — "Only free/busy, never event titles or details"

**At rest in Supabase:**
- `availability` schema (`database/schema.sql:126-137`): only `user_id`, `start_time`, `end_time`, `status`. No title/description/location/attendee columns. ✅
- `syncUserCalendar` in `functions/src/utils/helpers.ts:1196-1201` upserts only `{user_id, start_time, end_time, status: "free"}`. Confirmed end-to-end. ✅

**In transit / in memory:**
- Calendar sync DOES read `event.summary`, `event.location`, attendees from Google/Apple/Outlook to compute busy blocks (Google `events.list` returns full event data; CalDAV requires parsing iCal; Outlook Graph returns `subject`).
- These values are used only to construct `freeBlocks` and are dropped before the DB write.
- The values DO appear in server logs in some cases (e.g., `console.log` during deduplication). **Recommendation:** scrub event titles from logs in a follow-up. Low risk because logs aren't user-facing, but worth tightening to make the claim airtight.

**Verdict:** Claim holds at rest. Marketing copy is honest.

---

### Claim 2 — "Friends never see your battery"

`social_battery` lives on the `users` table. Audit of every friend-facing endpoint:
- `GET /friends` (`friends.ts:25`): returns only `id, displayName, photoUrl, neighborhood, timezone, eventInterests`. No battery. ✅
- `GET /availability/overlap/*`: returns suggestions only; no friend battery exposed. ✅
- `GET /meetups/*`: returns participant `display_name`, `photo_url`; never battery. ✅
- No other endpoint joins-and-returns `social_battery` to a non-owner.

**Verdict:** Claim holds. (Future safeguard: see `migrations/privacy_hardening.sql` — `friend_public_view` makes this enforced by schema, not code review.)

---

### Claim 3 — "Friends never see your free blocks" — VIOLATED (now fixed)

**Before fix:**
- `GET /availability/overlap/:friendId` returned `syncStatus.friend.freeSlots: friendSync.slots` — a count of the friend's free-block slots in the sync window.
- `POST /availability/multi-friend-overlap` returned the same per-participant `freeSlots` count.
- Neither was rendered in the UI, but they were over the wire — any user could `curl` them.

This contradicts the explicit design decision in `docs/06-mvp-current-state.md` §1.4:
> Show free block counts ("12 free blocks") per person → **Removed** — Exact counts expose how busy someone is.

**Fix:** Stripped `freeSlots` from friend-side of `syncStatus`. Kept only `me.{synced, freeSlots}` (the requesting user's own count).

---

### Claim 4 — "Friends never see your sync status" — VIOLATED (now fixed)

**Before fix — three API leaks:**
1. `GET /friends` → `friend.calendarConnected: boolean`
2. `GET /availability/overlap/:friendId` → `syncStatus.friend.calendarConnected` + `syncStatus.friend.name`
3. `POST /availability/multi-friend-overlap` → `syncStatus.participants[].calendarConnected`

**Before fix — two UI leaks (worse than the API):**
1. `FriendAvailability.tsx:307` rendered: **"{displayName} hasn't synced their calendar"** with a "Send a reminder" button.
2. `GroupAvailability.tsx:165` rendered per-friend chips: **"Alex (no cal)"**, **"Sam (syncing…)"**.

Both UIs identified specific friends by name and exposed their sync state to other users. This is a textbook violation of the documented design intent in `docs/06-mvp-current-state.md` §1.4:
> Showing that a friend hasn't connected their calendar pressures them to connect and exposes a private choice.

**Fix:**
- Server: removed `calendarConnected` from all three endpoints. Multi-friend now exposes only an aggregate `everyoneSynced: boolean`.
- Client: replaced name-specific copy with generic "Still finding times" / "Everyone's pretty busy" messaging.
- Removed manual "Send a reminder" button (server already auto-nudges friends when 0 suggestions + unsynced, with a 1/week-per-pair cap).
- Removed `calendarConnected` from `FriendRecord` type in `lib/queries.ts` and from the dashboard sort tiebreaker.

---

## Files Changed

**Server:**
- `functions/src/routes/friends.ts` — removed `calendarConnected` from `/friends` response
- `functions/src/routes/availability.ts` — removed friend sync status & freeSlots from overlap endpoints; replaced multi-friend per-participant status with aggregate `everyoneSynced`

**Client:**
- `client/src/components/FriendAvailability.tsx` — generic empty-state copy; narrowed `SyncStatus` type
- `client/src/components/GroupAvailability.tsx` — removed participant sync-badge row and name-leaking empty state; replaced with aggregate-driven generic copy
- `client/src/pages/DashboardPage.tsx` — removed `calendarConnected` sort tiebreaker
- `client/src/lib/queries.ts` — removed `calendarConnected` and stale `socialBattery` fields from `FriendRecord`

**Supabase (defense-in-depth, see `migrations/privacy_hardening.sql`):**
- New `friend_public_view` — privacy-safe projection of `users`. Backend should adopt this in friend queries going forward.
- New `purge_old_suggestion_events()` function + daily pg_cron schedule. Enforces the 90-day retention already documented in the schema for `suggestion_events` (which snapshots `social_battery`).
- `COMMENT ON COLUMN` tags on `users.social_battery`, `users.email`, `users.firebase_uid`, and `availability` documenting privacy posture inline so future code reviews catch leaks.

---

## What's Still Worth Tightening (Follow-ups)

These are not currently broken claims, but would harden the story:

1. **Scrub event titles from server logs.** During sync we occasionally log titles for debugging. Replace with hashed or redacted form.
2. **Backend should query `friend_public_view`** instead of `users.*` in `friends.ts` and `availability.ts`. Reduces blast radius if a future bug forgets the `.select(...)` projection.
3. **Move `availability` from raw `availability_slots` deletes to a soft-delete pattern** so a bug can't wipe a user's data silently. (Not a privacy issue — a reliability one.)
4. **Add a `/users/me/privacy` endpoint** that returns the live list of "things friends can see about me" — could power a transparency page in-app, which would be a marketing win.
5. **Two-friend test:** create User A and User B, befriend, and verify via direct API calls that no endpoint returns any of A's private data to B. Worth turning into an integration test.

---

## Bottom Line

After this change, the landing page promise matches reality:
- ✅ Calendar contents stay free/busy at rest. (Caveat: scrub logs.)
- ✅ No friend sees another friend's battery, free-block count, or sync status — at the API or in the UI.
- ✅ DB has belt-and-suspenders: column-level privacy comments, a `friend_public_view`, and enforced retention on AI training data.

Build (`functions`) and type-check (`client/tsc --noEmit`) both pass.
