# Sokka — History

## Key Patterns & Corrections

### Security Audit Findings (4 Critical)
1. Outlook tokens NOT in SENSITIVE_FIELDS → leaked to client via `GET /users/me`
2. No account deletion endpoint (GDPR/App Store violation)
3. Admin secret hardcoded fallback `"slotted-admin-2026"` if env var unset
4. Friend list response includes email addresses — enables email harvesting

### Functional Testing Audit (6 Core Journeys)
- **Critical:** `GroupAvailability.tsx` calls `POST /availability/group-overlap` — endpoint doesn't exist (backend only has `/multi-friend-overlap`).
- **High:** Simultaneous cross-friend-requests create permanent pending state; no future-time/endTime>startTime validation on meetups; `friend_groups` tables have zero API endpoints; counter-propose doesn't cancel original meetup.
- **Architecture insights:** Notifications overload `meetup_request` type for 4+ events → false dedup suppression. Calendar sync is destructive (DELETE all → INSERT new = brief zero-data window). Apple/Outlook have NO automatic sync.

### Multi-User Interaction Audit
- **Critical:** Account deletion leaves orphaned meetups (FK violation) + orphaned notifications. No block/mute feature.
- **High:** Counter-propose copies participants without checking friendship. No duplicate meetup detection. Scheduling with deleted friend returns confusing error.
- **Medium:** Multi-person decline doesn't notify remaining. No meetup expiry job. Calendar sync race condition. No nudge when friend lacks calendar.
- **Verified correct (14 checks):** Auto-accept simultaneous requests ✅, 7-day decline cooldown ✅, social battery never exposed ✅, friend lists private ✅, timezone handling UTC ✅, etc.

### E2E Test Infrastructure
- **Root causes of failures:** Payload key mismatches (~10), response mapping mismatches (~4), notification timing (~3), stale-state assertions (1).
- **Key pattern:** Backend uses camelCase for some endpoints (`friendIds`, `startTime`) and snake_case for others (`start_time`). No consistency — inspect each endpoint's `req.body`.
- **Fixes:** `acceptFriendship` sends `{ action: "accept" }` (not `{ status }`). `createMeetup` sends camelCase. `getFriends()` maps `friendshipId` → `id`.
- **Infrastructure:** `waitFor<T>(fn, predicate, maxAttempts, delayMs)` polling helper for async assertions.
- **Result:** 53→75 passing (94% success rate). Remaining 5 are backend issues (missing migration, authorization gap).

### Test Coverage Gaps (Priority)
1. Calendar sync engine (200+ lines, ZERO coverage)
2. OAuth token refresh/expiry
3. Multi-friend overlap computation
4. Google Calendar webhook handler
5. Admin endpoints (ZERO coverage)
6. Concurrent operations & race conditions

## Cross-Project Tester Knowledge (injected 2026-05-02)

### From EatDiscounted (McManus — Tester)
- **Zero tests = zero confidence.** Even minimal test suite prevents broken deploys.
- **Unicode normalization is a silent killer:** `"".includes("")` is true in JS → false positives.
- **Empty catch blocks hide failures:** Users see "found on 0" for errors — indistinguishable from real "not found."
- **Cache collision avoidance:** Unique input generators per test.
- **Mock patterns:** `vi.fn()` on fetch, API keys in `beforeEach`, test success + failure paths.

### From MyDailyWin (Purah — Tester)
- **localStorage sync minefield:** Admin writes `hr_admin_{profile}`, user reads `hr_state_{profile}`. Dual-write must be consistent across ALL write paths.
- **Undefined function bugs hide in vanilla JS apps** — only surface at runtime without TypeScript/bundler.
- **Profile-aware testing essential:** Always test with non-default configurations.
- **Parallel agent commits break structural integrity:** Missing closing tags, CSP gaps, FOUC. Mandatory integrity pass after parallel commits.

### From MyDailyWin (Riju — Security)
- **CSP `unsafe-inline` elimination:** 57+ inline onclick → `data-action` + event delegation.
- **Open redirect:** `?redirect=` param allowed arbitrary redirects. Validate targets.
- **Firestore rules: auth ≠ authorization:** 4 collections had auth-only rules (no ownership scoping).

### From Slotted (Alumni: Josh, Nate)
- **Webhook golden rule:** Always return 200, even on errors. Webhooks = "something changed" signals.
- **Multi-calendar move:** delete + create with NEW eventId. Correlate by content, not eventId.
- **Sync token architecture:** Stale token (410) → full re-sync. Must NOT create meetups from non-Slotted events.

## Session Archive Summary

Sokka completed 8+ sessions: two-way sync code review (3 critical bugs found), notification dedup test suite (6 tests), comprehensive bug & edge case audit (4 critical, 7 high, 9 medium), E2E test fix sprint (53→75 passing), deep functional testing audit (6 core journeys, 1 critical + 6 high + 11 medium findings), multi-user interaction audit (3 critical + 5 high + 5 medium), and full security/vulnerability audit contributing 4 critical + 7 high findings across the codebase.

## Learnings

### Frontend Stub Scan (2025-07-16)
- **Pattern found:** Counter-propose "Update time" button fakes success without actually calling a real endpoint. Same class of bug as the "Find time for N friends" stub — UI shows completion but backend is a no-op.
- **Dead code signal:** 5 query functions + interfaces in `queries.ts` are fully typed but never imported by any page/component. These represent planned features (activity feed, event discovery, calendar event view) that were never wired up.
- **SocialBattery component:** Fully built, never mounted. The `socialBattery` field is returned by the dashboard API but never rendered anywhere.
- **Silent failure anti-pattern:** NotificationDropdown's RSVP/friend-request handlers use `catch { /* silently fail */ }` — user gets no feedback when network calls fail. This is worse than a crash because the user thinks the action succeeded.
- **What was clean:** No duplicate rendering issues remain, no dead routes, no placeholder links, no empty onClick handlers, no `group-overlap` references. The Settings and FriendsPage bugs Shari found were isolated incidents, not systemic.
