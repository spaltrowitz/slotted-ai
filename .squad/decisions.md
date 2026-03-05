# Decisions

> Canonical record of team decisions. Append-only. Scribe merges from inbox.

---

## Architecture Decision: Two-Way Calendar Sync (Toph, 2026-02-28)

| Field | Value |
|---|---|
| **Author** | Toph (Lead) |
| **Date** | 2026-02-28 |
| **Status** | Proposed — awaiting user sign-off |
| **Scope** | LI-1: Two-Way Calendar Sync (RICE: 900) |

### Decision

Implement two-way Google Calendar sync using **push notifications (webhooks)** with **incremental sync tokens**, deployed in 4 phases. Google Calendar is source of truth for individual RSVP/deletion; Slotted is source of truth for multi-party state.

### Key Choices

1. **Webhooks over polling** for Google Calendar (near real-time, lower API cost)
2. **Per-user watch on 'primary' calendar** — Slotted only writes to primary, so that's where changes appear. Expand to per-calendar later if needed.
3. **Incremental sync tokens** to avoid re-fetching all events on each webhook.
4. **`rsvp_source` column** to prevent feedback loops between Slotted ↔ Google Calendar.
5. **New notification types** (`meetup_rsvp_changed`, `meetup_time_changed`, `meetup_counter_propose`) for analytics and future UX differentiation.
6. **Soft notification language** for calendar-originated declines: "is no longer available" not "declined."
7. **No new frontend API calls** — the sync is entirely server-driven via existing webhook infrastructure.

### Privacy Assessment

No new privacy risks. Webhook data stays server-side. We only inspect events matching our own `google_event_id`. Friends see RSVP changes through existing notification system with soft language. The `rsvp_source` column is internal — users never see whether a change originated from the calendar or the app.

### Phases

| Phase | Effort | What Ships |
|---|---|---|
| 1. Watch channels | 2–3 days | Real-time webhook pipeline wired up (prerequisite) |
| 2. RSVP & deletion sync | 3–4 days | Core feature: Google Calendar RSVP/delete → Slotted update |
| 3. Time change detection | 2–3 days | Counter-propose flow for calendar-originated time moves |
| 4. Apple + hardening | 1–2 weeks | CalDAV polling, rate limiting, monitoring |

### Risks

- **Google API quota**: Watch channels count against quota. Negligible at current scale (~20 users).
- **Missed webhooks during renewal gap**: Scheduled function runs every 6 hours; worst case, a 6-hour gap between channel expiry and renewal.
- **OAuth token plaintext storage**: Pre-existing risk (flagged in improvement analysis). Two-way sync doesn't worsen it but motivates encryption.

### Plan Document

`docs/plans/plan-two-way-calendar-sync.md`

---

## Edge Cases Affecting Two-Way Sync Architecture (Sokka, 2026-02-27)

**From:** Sokka (QA)  
**To:** Toph (Architect), Shari  
**Date:** 2025-02-27  
**Priority:** High — these need architecture decisions before implementation

### Critical Edge Cases

#### 1. Multi-Calendar Watch Channels (EC-06)

**Problem:** Users can have multiple Google calendars selected in `user_calendars`. When Slotted auto-adds an event to their primary calendar and the user moves it to a different calendar, the event gets a new `eventId`. If we only watch the primary calendar, we'll see a deletion (→ false decline) and miss the new event on the other calendar.

**Options:**
- (a) Watch all selected calendars — more API quota usage, more webhook volume, but full coverage
- (b) Watch only the calendar where Slotted creates events — simpler, but moves between calendars look like deletions
- (c) Watch primary only, but on "deletion" do a cross-calendar search before treating as a decline

**Recommendation from QA:** Option (b) with a grace period before treating deletion as decline (e.g., wait 60 seconds and re-check). This limits blast radius while catching most moves.

#### 2. Webhook Debouncing Strategy (PF-02)

**Problem:** Google sends a push notification saying "something changed" but doesn't say what. We must call `events.list` with a sync token to find out. If 20 notifications arrive in 5 seconds (common during bulk edits or DST), we'd make 20 redundant API calls.

**Architecture need:** A per-user mutex or debounce mechanism. Options:
- (a) In-memory lock per Cloud Function instance (doesn't work — functions are stateless)
- (b) Firestore/Supabase-based lock with TTL
- (c) Cloud Tasks queue with deduplication by user ID

**Recommendation from QA:** Option (c) — Cloud Tasks gives us exactly-once semantics and built-in retry. The webhook endpoint enqueues a task, the task does the actual sync.

#### 3. Time Drift Policy (HP-03, CF-04)

**Problem:** When a user drags a meetup event to a different time in Google Calendar, what should Slotted do? The spec says "flag for counter-propose flow" but doesn't define the mechanic.

**Scenarios to cover:**
- Small drift (< 30 min): probably user adjusting for traffic — might be acceptable to auto-accept
- Large drift (> 1 hour): definitely a reschedule — should trigger counter-propose
- All-day conversion: ambiguous — could mean "I blocked the day" not "change the time"

**Need from Toph:** Define thresholds and the flow. My tests will assert against whatever is decided.

#### 4. Stale Sync Token Recovery (EC-10)

**Problem:** If `calendar_sync_token` goes stale (Google returns 410), we need a full re-sync. During a full sync, we might find Google events that don't correspond to any Slotted meetup (user's personal events). We MUST NOT create meetups from these — only match against existing `google_event_id` values.

**Risk:** If the full sync code uses the same "process new events" path as the incremental sync, it might try to create meetup records from non-Slotted events. The sync handler needs separate paths for "known Slotted events" vs. "unknown events."

### Non-Critical But Notable

- **EC-08 (unknown channel ID):** Must return 200, not 4xx. Google will deactivate our endpoint if it gets too many errors. This is a correctness requirement, not just a nice-to-have.
- **PF-04 (bulk channel renewal):** Google's `events.watch` has a per-user rate limit. Renewing 500 channels needs batching with delays. Budget ~15 min for the scheduled function.
- **AP-03 (Apple auth failure):** Don't retry with bad credentials — Apple/iCloud may lock the account after repeated failures.

---

## Decision: Calendar Sync Notification Rendering (Keeley, 2026-03-02)

| Field | Value |
|---|---|
| **Author** | Keeley (Frontend Dev) |
| **Date** | 2026-03-02 |
| **Status** | Implemented |
| **Scope** | Two-Way Calendar Sync — frontend notification types |

### Decision

Added three new notification types to `NotificationsPage.tsx` for the two-way calendar sync feature:

- `meetup_rsvp_changed` — 🔄 sky-blue theme, "View meetup" CTA
- `meetup_time_changed` — 🕐 indigo theme, "View meetup" CTA
- `meetup_counter_propose` — 💡 violet theme, "View meetup" CTA (accept/dismiss UI deferred to Phase 3)

### Key Choices

1. **All three types in Reminders tab** — they're informational, not actionable (yet). `meetup_counter_propose` will move to Requests tab once Phase 3 adds accept/dismiss UI.
2. **"View meetup" links to `/dashboard`** — no dedicated meetup detail route exists. When one is added, update these links.
3. **No new components** — followed existing pattern of adding to `typeConfig` + inline JSX blocks.
4. **Soft language is backend-driven** — notification `title` and `body` come from the server. Frontend only controls emoji, colors, and CTA text. CTA text uses neutral "View meetup."

### Open Items

- Phase 3: Add accept/dismiss UI for `meetup_counter_propose` (move to Requests tab at that point)
- Future: When a meetup detail page is built, update the "View meetup" link target

---

## Roy — Two-Way Sync Implementation Decisions (2026-03-02)

### Summary
- Applied `calendar_sync_token` only for the primary Google calendar (calendar id `"primary"` or matching the user's email) since there is a single token stored per user.
- When a sync token returns a 410, the token is cleared and the calendar is re-fetched without a sync token to preserve availability accuracy.

### Notes
- Watch channel creation/teardown and webhook integration follow the plan without further deviations.

---

## CRIT Fixes: Two-Way Calendar Sync (Zuko, 2026-03-03)

| Field | Value |
|---|---|
| **Author** | Zuko (Backend Dev) |
| **Date** | 2026-03-03 |
| **Status** | Implemented — deployed |
| **Scope** | Critical bug fixes from Sokka's code review |

### Summary

Fixed 3 critical bugs from Sokka's code review of Two-Way Calendar Sync (Phases 1–3). All fixes committed as 5db77f9. Build passes.

### CRIT-1: Feedback Loop Prevention

**Problem:** `rsvp_source` selected but never checked. Stale webhooks could overwrite app-sourced RSVPs.

**Fix:**
- Added `gcal_last_synced_at` to participant query
- Added `isRecentAppChange` guard: if `rsvp_source === 'app'` AND sync within 60s, skip RSVP change
- Applied to both cancelled-event and RSVP-mapping paths
- Fixed secondary bug: cancelled-event `continue` now updates etag before skipping

### CRIT-2: Disconnect Cleanup

**Problem:** `POST /calendar/disconnect` left `calendar_watch_channel`, `calendar_watch_resource_id`, `calendar_sync_token` orphaned. Stale watch channels kept firing webhooks; orphaned `google_event_id` caused sync confusion on reconnect.

**Fix:**
- Added null fields to user update at line 6536
- Added separate query to null `google_event_id` on participant rows

### CRIT-3: Webhook Returns 200

**Problem:** Webhook returned 403 for invalid tokens. Google deactivates endpoints returning 4xx.

**Fix:**
- Changed to `console.warn()` + `res.status(200).send("OK")`
- Any webhook handler must NEVER return non-2xx — log the error, always respond 200

### Verification
- `npm run build` ✅
- No schema changes
- Ready for production

---

## Code Review: Two-Way Calendar Sync — Phases 1–3 (Sokka, 2026-03-03)

| Field | Value |
|---|---|
| **Author** | Sokka (QA) |
| **Date** | 2026-03-03 |
| **Status** | Conditional Approve — 3 critical issues fixed (Zuko) |
| **Scope** | `functions/src/index.ts` lines 6440–8000, `client/src/pages/NotificationsPage.tsx` |

### Verdict

Structurally sound. Core happy paths covered well. **3 critical bugs + 2 high-severity gaps** identified and fixed by Zuko (commit 5db77f9). Notification language compliant with soft social dynamics ✅.

### Coverage Scorecard

| Category | ✅ Covered | ⚠️ Partial | ❌ Missing | 🔮 Future |
|----------|-----------|-----------|-----------|----------|
| Happy Path (6) | 5 | 1 | 0 | 0 |
| Conflicts (5) | 2 | 2 | 1 | 0 |
| Edge Cases (10) | 4 | 2 | 2 | 2 |
| Privacy (5) | 3 | 2 | 0 | 0 |
| Performance (4) | 1 | 2 | 1 | 0 |
| **Total (30)** | **15** | **9** | **4** | **2** |

**Coverage: 15/30 fully covered (50%), 9/30 partial (30%), 4/30 missing (13%), 2/30 deferred (7%).**

### Notification Language Audit

All user-facing strings comply with soft social dynamics:
- Decline: "is no longer available" ✅
- Maybe: "is now a maybe" ✅
- Time change: "updated the time" ✅
- Counter-propose: "suggests a different time" ✅
- Frontend: "Not this time" (never "declined") ✅

---

## Decision: Counter-Propose Notification Actions (Keeley, 2026-03-02)

| Field | Value |
|---|---|
| **Author** | Keeley (Frontend Dev) |
| **Date** | 2026-03-02 |
| **Status** | Implemented — Requests tab |
| **Scope** | Phase 3 interactivity |

### Decision

Upgraded `meetup_counter_propose` notifications from informational to actionable:
- **"💡 Update time"** — primary action, violet accent. Calls `PATCH /meetups/:id/rsvp` (interim signal), marks read.
- **"Keep original"** — secondary. Marks read without side effect.

Moved to Requests tab (was Reminders).

### Key Choices
- Three-state rendering: unread (buttons) → acted (pill) → already-read (fallback link)
- Soft language: "Update time" / "Keep original" (never "Accept" / "Reject")
- RSVP endpoint as interim — awaiting dedicated backend endpoint for actual time update

### Open Items
- Backend: Need endpoint for creator to accept counter-proposal and update meetup time
- UX: "View meetup" link should target dedicated meetup detail page (not `/dashboard`) when available

---

## Decision: Time Change Detection Routing (Roy, 2026-03-03)

| Field | Value |
|---|---|
| **Author** | Roy (Backend Dev) |
| **Date** | 2026-03-03 |
| **Status** | Implemented |
| **Scope** | Phase 3 — calendar time changes |

### Decision

When a Google Calendar event time changes for a Slotted meetup:

1. **Creator moved it** → Meetup `start_time`/`end_time` updated directly. All participants get `meetup_time_changed` notification.
2. **Non-creator moved it** → No meetup times changed. Creator gets `meetup_counter_propose` notification with suggested time.

### Key Choices
- **ISO string comparison** for time equality (avoids timezone edge cases)
- **No threshold logic** — any time difference triggers flow (can add thresholds later)
- **Counter-propose is notification-only** — no accept/dismiss UI yet (deferred per Keeley)

---

## Decision: CORS Hardening (QW-4)

**Author:** Zuko  
**Date:** 2025-07-22  
**Status:** Implemented  

### Context
The CORS middleware in `functions/src/index.ts` had a security hole: the fallback for unknown origins was `callback(null, true)`, allowing any domain to make authenticated API requests.

### Decision
Changed the else branch to `callback(new Error("Not allowed by CORS"))` so unknown origins are rejected with a CORS error.

### Allowed Origins (unchanged)
- `http://localhost:5173` — Vite dev server
- `http://localhost:5174` — Vite dev server (alternate port)
- `https://slotted-ai.web.app` — Firebase Hosting (production)
- `https://slotted-ai.firebaseapp.com` — Firebase Hosting (alternate)

### Trade-offs
- Requests with no `Origin` header (mobile apps, curl, server-to-server) are still allowed through — this is standard and intentional. Firebase Auth middleware is the real gatekeeper for those.
- If a staging domain is added later, it needs to be added to `allowedOrigins` or the request will be blocked.

### Files Changed
- `functions/src/index.ts` line 55 — one-line change

---

## Decision: Firebase Functions Deploy Success (Zuko, 2026-03-03)

| Field | Value |
|---|---|
| **Author** | Zuko (Backend Dev) |
| **Date** | 2026-03-03 18:30 |
| **Status** | Deployed |
| **Scope** | Production deployment — all 5 functions live |

### Summary

Firebase Functions deploy succeeded after `.env` was populated with real credentials. All functions now at `https://api-xwsmuazwmq-uc.a.run.app`.

### Functions Deployed

- `api` — Express app + all HTTP routes
- `findCalendarMatches` — AI matching engine
- `renewCalendarWatchChannels` — Scheduled watch renewal
- `sendMeetupReminders` — Scheduled reminders
- `sendPendingRsvpNudges` — Scheduled nudges

### Key Outcomes

- Node.js 24 engine accepted without downgrade
- All webhooks now reachable from Google Calendar service
- Calendar sync pipeline operationalized
- Build passed with no code changes

### Open Items

- User to run migration column-check in Supabase SQL Editor (statements 1–4 pending)

---

## Decision: Landing Page Section Redesign (Suki, 2026-03-03)

| Field | Value |
|---|---|
| **Author** | Suki (Designer) |
| **Date** | 2026-03-03 |
| **Status** | Implemented |
| **Scope** | LoginPage.tsx — Early Access badge + "Why It Matters" section |

### Summary

Redesigned two elements of the public landing page to fix visual hierarchy and section differentiation issues reported by Shari.

### Changes

#### 1. Early Access Badge

**Problem:** Badge used teal color identical to the CTA button, creating no visual hierarchy. The tiny 1.5px pulsing dot was too subtle and the badge lacked urgency.

**Fix:**
- Color shifted from teal → amber/orange gradient (`from-amber-50/90 to-orange-50/90`, `text-amber-800`)
- Replaced pulsing dot with ✨ sparkle emoji for personality
- Bumped padding (`px-3 py-1` → `px-4 py-1.5`) and weight (`font-medium` → `font-semibold`)
- Added `shadow-sm` for subtle depth
- Added urgency copy: "Early access — limited spots"

#### 2. "Why It Matters" Section

**Problem:** Visually identical to "How It Works" — same pastel gradient cards, same borders, same heading style, same hover effects. Users couldn't distinguish sections while scanning.

**Fix:**
- Wrapped entire section in a `rounded-3xl` dark panel (`from-slate-900 via-slate-800 to-slate-900`) with `shadow-xl`
- Cards changed from colored pastel fills to frosted glass: `bg-white/[0.06]` with `border-white/[0.08]`
- Text inverted: titles → `text-white`, descriptions → `text-slate-400`
- Hover changed from translate-y lift to subtle opacity shift (`hover:bg-white/[0.10]`)
- Removed per-card color/border data (no longer needed on dark surface)
- Added more vertical breathing room (`mb-6` → `mb-8`)

### Design Rationale

- The dark panel creates an unmistakable visual break between "How It Works" (light, colorful, step-based) and "Why It Matters" (dark, refined, value-based)
- Amber badge avoids competing with teal CTAs — warm gold connotes exclusivity
- No new CSS classes or design tokens introduced — all standard Tailwind utilities
- Respects Slotted's product principles: no pressure language in the badge copy, privacy card retained prominently

### Files Changed

- `client/src/pages/LoginPage.tsx` — lines 36-39 (badge), lines 137-184 (Why It Matters section)

---

## Phase 4 Priority Recommendations (Sokka, 2026-03-03)

| Field | Value |
|---|---|
| **Author** | Sokka (QA) |
| **Date** | 2026-03-03 |
| **Status** | Proposed — awaiting user sign-off |
| **Scope** | HIGH issues from Phase 1–3 review + Phase 4 ordering |

### HIGH Issues Assessment

#### HIGH-1: Creator Time Change Silently Overrides Group Meetup Time

**What happens now:** When a meetup creator drags an event in Google Calendar, `processCalendarChanges()` (line 8120) directly updates `meetups.start_time`/`end_time` for ALL participants and sends a `meetup_time_changed` notification. No one gets a say.

**Why this is a problem:** Imagine a 4-person brunch. The creator drags it from 11am to 8am in Google Calendar — maybe they were just exploring times, maybe it was a fat-finger. Everyone's meetup silently changes. In a friendship app, unilateral time changes feel controlling and break trust.

**User impact:** MEDIUM-HIGH. Doesn't cause data loss, but violates Slotted's design principle #4 ("reduce friction") by creating friction — people learn they can't trust meetup times to stay put. For 1:1 meetups the behavior is arguably fine (it's your plan together), but for group meetups it's clearly wrong.

**Urgency:** Fix before shipping to more beta testers, but not a blocker for current ~20 users. The fix is small: route creator time changes through the same counter-propose flow for group meetups (3+ participants), allow direct update only for 1:1s. Estimated effort: 1–2 hours.

**Recommendation:** Fix BEFORE Phase 4. This is a design correctness issue, not a technical debt item.

#### HIGH-2: 410 Stale Sync Token Doesn't Retry in Webhook Handler

**What happens now:** In the webhook handler (line 8296), when `events.list` returns 410 (stale sync token), the code clears `calendar_sync_token` but then falls into the `catch` block and exits. No retry. The `syncUserCalendar()` function (line 1633) handles 410 correctly with a retry, but the `processCalendarChanges` path does not.

**Result:** The webhook that triggers the 410 processes zero meetup changes. The NEXT webhook will do a full sync (no token → full fetch), but there's a one-webhook delay. During that delay, any RSVP/time changes from this webhook are invisible to Slotted.

**User impact:** LOW-MEDIUM. Most users won't notice because another webhook usually follows quickly (Google often sends multiple). The edge case where it matters: user declines a meetup in Google Calendar right when the sync token expires. Their decline isn't reflected until the next calendar change triggers another webhook — could be minutes or hours.

**Urgency:** Worth fixing, but not urgent. The window is small and self-healing. Estimated effort: 30 minutes — add a retry block after clearing the token.

**Recommendation:** Fix BEFORE Phase 4, since you're already in the webhook handler code and the fix is trivial. Bundle with HIGH-1.

### Phase 4 Item Analysis

#### 1. Integration Tests — DO FIRST

**Why:** There are zero automated tests in this project. The `tests/` directory contains only agent scaffolding. Every bug found so far (CRIT-1, CRIT-2, CRIT-3, both HIGHs) was found by manual code review. That's not sustainable.

Before adding more complexity (rate limiting, Apple Calendar, monitoring), we need a test harness that catches regressions. Otherwise every new change is a gamble.

**Minimum viable test suite:**
- Webhook handler: valid channel → sync fires, invalid channel → 200 response (no crash)
- `processCalendarChanges`: event deleted → RSVP declined, RSVP changed → mapped correctly, time changed by creator vs. non-creator → correct routing
- Feedback loop prevention: `rsvp_source = 'app'` within 60s → skip
- 410 recovery: stale token → clears and retries
- `mapGoogleRsvp`: all status mappings

This can be done with unit tests against the business logic functions — no need for a full E2E framework yet. Mock Supabase, mock Google API.

#### 2. Monitoring/Logging — DO SECOND

**Why:** We're running in production with ~20 beta testers and have NO visibility into sync behavior. When something goes wrong, we find out from user complaints ("my meetup didn't update"), not from logs.

**Minimum viable monitoring:**
- Structured log line on every webhook: `{ event: "webhook_received", userId, channelId, eventsProcessed: N, syncTokenUsed: bool }`
- Structured log line on every RSVP change from calendar: `{ event: "calendar_rsvp_sync", userId, meetupId, oldRsvp, newRsvp, source: "google_calendar" }`
- Error counter for 410s, OAuth failures, unmatched channels
- Optional: a simple `/admin/sync-stats` endpoint that queries recent sync activity from logs

Don't need Datadog or PagerDuty. Firebase Functions already logs to Cloud Logging — just need structured log lines we can query.

#### 3. Rate Limiting — DO THIRD

**Why:** Important for scale, but with ~20 users, webhook storms are unlikely to cause real problems. Google's own rate limits are the actual ceiling right now.

**What to add:**
- Per-user sync debounce: if a webhook fires for a user who was synced within the last 30 seconds, skip (use a Firestore/Supabase timestamp check)
- Exponential backoff on Google API 429s (partially exists in `syncUserCalendar` but not in `processCalendarChanges`)

This is a ~half-day task and prevents a real problem before it becomes one at 100+ users.

#### 4. Apple Calendar (CalDAV) — DO LAST (or defer entirely)

**Why this is premature:**
- CalDAV is a completely different protocol with different auth, different change detection, and different edge cases
- None of the beta testers have reported Apple Calendar as a pain point
- The existing Apple Calendar integration (one-way write via ICS download/subscription) covers the basic case
- Adding CalDAV polling introduces a new scheduled function, new auth flow (app-specific passwords or Sign in with Apple), new failure modes
- The two-way sync for Google Calendar isn't fully hardened yet

**Recommendation:** Defer Apple CalDAV to Phase 5 or later. If beta testers ask for it, reconsider. Don't build it speculatively.

### Recommended Priority Order

1. **HIGH-1 Fix: Creator time change routing** — Design correctness bug. Route group meetup creator changes through counter-propose. (~2 hours)
2. **HIGH-2 Fix: 410 retry in webhook handler** — Add retry after clearing stale token. (~30 minutes)
3. **Integration tests for sync pipeline** — Zero tests exist. Build a minimal test harness for the webhook→sync→RSVP flow. (~2–3 days)
4. **Structured logging/monitoring** — Add queryable log lines to webhook handler and `processCalendarChanges`. (~1 day)
5. **Rate limiting / webhook debounce** — Per-user sync debounce + 429 backoff. (~half day)
6. **Apple Calendar CalDAV** — Defer. No user demand, high complexity, Google sync not yet hardened.

### Rationale

Items 1–2 are small fixes that should be bundled into a single commit before anything else. They fix real user-facing bugs in shipped code.

Item 3 (tests) comes before items 4–5 because monitoring and rate limiting add code paths that themselves need testing. Building the test harness first means every subsequent change ships with confidence.

Items 4–5 are operational hardening that becomes more important as the user base grows. At ~20 users, the risk is low but the cost of adding them is also low — good investment.

Item 6 (Apple Calendar) is explicitly deferred. It's a significant effort with uncertain ROI and the Google sync path needs more maturity first.

### Open Question for Shari

**HIGH-1 fix — what's the right behavior for 1:1 meetups?**

Option A: Creator can always change time directly for 1:1 meetups (current behavior, seems reasonable for two people)
Option B: All time changes go through counter-propose regardless of participant count

My recommendation is Option A — for 1:1 meetups, the creator dragging it in Google Calendar is equivalent to texting "hey can we do 3pm instead?" The counter-propose adds friction for no benefit when it's just two people. But for 3+ participants, counter-propose is the right call.

---

## Decision: Empty State Strategy (Katara, 2025-01-27)

**Author:** Katara (Frontend Dev)  
**Scope:** QW-1 + QW-6

### Decision

Adopted a tiered empty state approach across all main pages:

1. **Zero-data state** (brand new user, no friends) — warm welcome with primary CTA to invite friends
2. **Partial-data state** (has friends, no hangouts/events) — encouraging nudge with contextual CTA to take next step
3. **Filtered-empty state** (data exists but current filter shows nothing) — reassurance + suggest changing filters

### Rationale

- NotificationsPage and EventsPage already had good coverage for all 3 tiers — left as-is
- FriendsPage had a zero-data state but no CTA buttons — users saw "enter email above" but no share buttons. Added Text + Copy link buttons directly in the empty state
- DashboardPage had the welcome state (tier 1) but no tier 2 for "has friends, no meetups" — added a dashed-border card with "Find a time with a friend" CTA

### InvitePage (QW-6)

Built InvitePage as a public route (`/invite/:code`) that:
- Looks up the inviter via existing `GET /users/invite/:code` endpoint
- Shows inviter photo + name with sign-up CTA for logged-out users
- Auto-sends friend request for logged-in users and redirects to /friends

This was the critical growth-loop fix — invite links were 404ing before this change.

---

## Improvement Analysis (Toph, 2026-02-27)

**Summary:** Toph's full-stack codebase analysis identified 18 prioritized improvements:
- 6 Quick Wins (empty states, OAuth verification, counter-propose wiring, CORS hardening, token encryption, invite route fix)
- 7 Medium Lifts (backend split, integration tests, GDPR features, email fallback, onboarding pipeline, Lighthouse optimization, algorithm transparency)
- 5 Large Initiatives (two-way calendar sync, recurring commitments, SMS bridge, ML preference learning, couple/family mode)

**Key Findings:**
- Backend monolith (8,371 lines) is the #1 velocity blocker
- Empty states + onboarding pipeline are the #1 UX blockers (drop-off moments)
- OAuth tokens in plaintext (security liability)
- InvitePage route missing (growth blocker — invite links 404)

**Immediate:** All 6 Quick Wins (low risk, high impact)  
**Next sprint:** Backend split + integration tests (unblock velocity)  
**Following:** GDPR + email fallback + onboarding pipeline  
**V2:** Two-way sync + recurring commitments

---

## Decision: Narrow Notification Dedup Index to friend_request Only (Zuko, 2026-03-04)

| Field | Value |
|---|---|
| **Author** | Zuko (Backend Dev) |
| **Date** | 2026-03-04 |
| **Status** | Applied (migration updated) |
| **Scope** | Notification deduplication hardening |

### Context

The `deduplicate_notifications.sql` migration originally created a unique partial index on `(user_id, type, related_user_id) WHERE type IN ('friend_accepted', 'friend_request')`. Root cause found during hardening review: `friend_accepted` type is **overloaded** — it's used for actual friend acceptances AND for group membership notifications (added/removed from groups at lines 3298, 3319, 3408, 3430).

### Problem

The unique index would silently block legitimate group notifications because the `(user_id, type, related_user_id)` tuple collides between friend and group contexts. The 23505 constraint handler catches these collisions and silently skips them, which is correct behavior for duplicates but wrong for group notifications.

### Decision

1. **Unique index only on `friend_request`** — safe because it has a single call site and should never have legitimate duplicates.
2. **No DB constraint on `friend_accepted`** — app-level dedup (1-hour window on relatedUserId) handles it. The type overloading makes a DB constraint unsafe.
3. **Scoped the cleanup DELETE** to only target `friend_request` and `friend_accepted` with title pattern matching, avoiding collateral deletion of group or meetup notifications.

### Future Tech Debt

The `friend_accepted` type should be split: actual friend acceptances vs. a new `group_update` type. This would allow a proper unique index on real friend_accepted notifications. Requires schema + frontend changes — flagging for a future sprint.

### Impact

- Migration file: `migrations/deduplicate_notifications.sql` (narrowed index + scoped cleanup)
- No code changes to `functions/src/index.ts` (createNotification logic is correct as-is)

---

## Decision: Notification Dedup Test Coverage (Sokka, 2026-03-04)

| Field | Value |
|---|---|
| **Author** | Sokka (Tester) |
| **Date** | 2026-03-04 |
| **Status** | Implemented |
| **Scope** | E2E test suite for notification deduplication |

### What

Created `tests/agents/src/scenarios/notification-dedup.ts` with 6 E2E tests covering the cascading dedup fix in `createNotification()`. Added `connectReferral()` and `acceptFriendshipAction()` methods to the `SlottedClient`.

### Tests

1. **Single notification on referral connect** — cleans slate, connects via referral, asserts exactly 1 friend_accepted notification
2. **No duplicate on rapid reconnect** — fires connect-referral twice in succession, asserts still only 1 notification
3. **Different types coexist** — friend_accepted and other types for the same user pair are not cross-deduped
4. **Different user pairs produce separate notifications** — planner gets friend_accepted from both spontaneous and flaky
5. **Global invariant: no duplicate friend_accepted per user pair** — scans all agents
6. **Global invariant: no duplicate friend_request per user pair** — scans all agents

### Pre-existing Issue Noted

`acceptFriendship()` in the client sends `{ status: "accepted" }` but the backend PATCH /friends/:friendshipId expects `{ action: "accept" }`. Added `acceptFriendshipAction()` with the correct payload rather than fixing the existing method (would break other scenarios that depend on it).

### For Team

- Run with: `npm run scenario:notification-dedup` from `tests/agents/`
- Tests compile clean (`tsc --noEmit` passes)
- Tests require live backend + credentials to actually execute

---

## Decision: Group Meetup Time Changes Require Consent (Zuko, 2026-03-04)

| Field | Value |
|---|---|
| **Author** | Zuko (Backend Dev) |
| **Date** | 2026-03-04 |
| **Status** | Implemented |
| **Scope** | `processCalendarChanges` in `functions/src/index.ts` |

### Context

Sokka's QA review (HIGH-1) identified that when a meetup creator drags a calendar event to a new time, the system auto-updated the meetup time for ALL participants — including group meetups. This violates Slotted's "no social pressure" principle: one person shouldn't unilaterally reschedule a group.

### Decision

- **Group meetups (3+ participants):** Creator time changes via Google Calendar do NOT auto-update the meetup. Instead, all other participants receive a notification: "wants to change the time" with the proposed new time. The meetup keeps its original time.
- **1:1 meetups (2 participants):** Auto-update behavior is preserved. The other participant gets a "updated the time" notification (existing behavior).

### Rationale

- Group dynamics are fundamentally different from 1:1. Changing a group's schedule requires buy-in.
- Notification language is intentionally soft ("wants to" vs "updated") per Slotted design principles.
- Future work: a proper counter-propose/vote flow for group time changes. For now, notification-only is the safe default.

### Trade-offs

- The group's meetup time stays frozen until a proper reschedule mechanism exists. This is better than silently overriding everyone.
- The creator's Google Calendar event may now be out of sync with the Slotted meetup time (their drag moved it, but Slotted didn't follow). Acceptable for now.

---

## Decision: 410 Stale Sync Token — Immediate Full Sync Retry (Zuko, 2026-03-04)

| Field | Value |
|---|---|
| **Author** | Zuko (Backend Dev) |
| **Date** | 2026-03-04 |
| **Status** | Implemented |
| **Scope** | Webhook handler in `functions/src/index.ts` |

### Decision

When Google returns a 410 (stale sync token), the webhook handler now:
1. Clears the sync token in the database
2. Immediately retries with a full sync (no syncToken)
3. Processes all returned events and saves the new sync token

Previously, it cleared the token and exited — causing a one-webhook delay before sync caught up.

### Guard Rails

- Max 1 retry per webhook call (full sync can't produce another 410)
- Retry failure is caught separately and logged — doesn't affect the main error handling

---

## Decision: Default Hangout Windows for Meetup Suggestions (Zuko, 2026-03-04)

| Field | Value |
|---|---|
| **Author** | Zuko (Backend) |
| **Date** | 2025-07-25 |
| **Status** | Implemented |
| **Scope** | Calendar overlap / suggestion endpoints |

### Context

Slotted was suggesting meetup times like "Sunday 7:30 PM" — technically free on both calendars but not a typical time for friends to hang out.

### Decision

Added a `DEFAULT_HANGOUT_WINDOWS` config that restricts **all suggested meetup times** to:

- **Friday:** 5 PM – 11 PM
- **Saturday:** 9 AM – 11 PM
- **Sunday:** 9 AM – 5 PM
- **Mon–Thu:** No suggestions

This filter applies to `/availability/overlap`, `/availability/group-overlap`, and the `findCalendarMatches` scheduled function. It does NOT apply to external event matching (`/events/match`, `/events/suggestions`) since those have fixed times.

### Trade-offs

- **Pro:** Prevents socially awkward suggestions (Sunday night, weekday mornings).
- **Pro:** Config is a simple constant — easy to adjust or extend for weeknight hangouts later.
- **Con:** Users who prefer Monday lunch hangouts won't get suggestions until we add per-user overrides.

### Future Extension

The config could become per-user (stored in the `users` table) to support custom hangout preferences. For now, the system-wide default matches the majority use case.

---

## Decision: Settings Page Information Density (Suki, 2026-03-04)

| Field | Value |
|---|---|
| **Author** | Suki (Designer) |
| **Date** | 2025-07-25 |
| **Status** | Implemented |
| **Scope** | Settings page UX cleanup |

### Decision

Strip verbose explanatory text from the Settings page. Each section header now shows only the title (no subtitle). Inline helper text on sub-fields was shortened or removed where the control's label is self-explanatory. Redundant summary/info boxes were removed.

### What Changed

1. **Section headers**: Removed all "We use this to..." subtitles from sections 1–5. The numbered badges + title are sufficient.
2. **Share hangout toggle**: Collapsed from toggle + separate status box into a single card with dynamic subtitle text.
3. **Social Battery summary**: Removed the dynamic "💡 Slotted.ai will..." summary box — it just restated the user's selection.
4. **Event Interests info box**: Removed the blue "💡 These preferences help..." note — self-evident.
5. **Feedback**: Shortened header from "Share Feedback" to "Feedback", trimmed copy.
6. **Spacing**: `space-y-10` → `space-y-6` between sections, `p-5` → `p-4` on cards, tightened inner dividers from `mt-4 pt-4` to `mt-3 pt-3`.
7. **Sub-field labels**: Shortened ("Where are you based?" → "Neighborhoods", "When are you free to hang out?" → "When are you free?", etc.) and removed sub-descriptions where the label is sufficient.

### Rationale

Settings pages are for returning users who know what they want to change. Verbose explanations belong in onboarding, not settings. Every line of text the user doesn't need to read is friction.

---

## Directive: Default Hangout Windows (Shari, 2026-03-04)

| Field | Value |
|---|---|
| **Author** | Shari Paltrowitz (via Copilot) |
| **Date** | 2026-03-04 |
| **Type** | User directive |

### Request

Default suggested meetup times should be: Friday evening (after work), Saturday all day, Sunday until 5 PM. Sunday 7:30 PM is not a normal time to suggest people hang out. No suggestions outside these windows.

### Notes

Captured for team memory. Aligns with implemented hangout windows decision.
# Decision: "Why It Matters" card copy rewrite

**Author:** Suki (Designer)
**Date:** 2025-07-25
**Status:** Implemented

## Context

The 5 "Why it matters" feature cards on the landing page had copy issues:
- Word orphaning on mobile ("out", "fast" landing alone on lines)
- No mention of group support (copy said "both of you")
- Privacy card was misleading (claimed we never see details, but newsfeed sharing exists)
- "Find something fun" card promoted a tertiary feature instead of Slotted's core value

## Decision

Rewrote all 5 cards:

| # | Emoji | Title | Description |
|---|-------|-------|-------------|
| 1 | 🗓️ | Plans, not promises | Find times that actually work — for a friend or the whole group. |
| 2 | 💬 | Skip the group text | Turn "let's hang" into a real plan without the back-and-forth. |
| 3 | 🔔 | Stay in the loop | Get a gentle nudge when it's been a while since you hung out. |
| 4 | ⚡ | Zero scheduling hassle | Connect your calendars and Slotted finds when everyone's free. |
| 5 | 🔒 | Your calendar stays private | We only see free or busy, never details. You control what friends can see. |

## Key choices

- **Replaced "Find something fun"** with "Zero scheduling hassle" — scheduling pain is the #1 reason people use Slotted, event discovery is not.
- **Privacy card now honest:** Says "You control what friends can see" instead of claiming we never share anything.
- **Emoji 📅 → 🗓️** on card 1 to avoid duplicating the "How It Works" section's emoji.
- **All titles 3–4 words** to prevent orphaning at 320px mobile viewports.

---

## Decision: Replace Mobile Calendar Grid with Upcoming Hangouts List (Katara, 2026-03-05)

| Field | Value |
|---|---|
| **Author** | Katara (Frontend) |
| **Date** | 2026-03-05 |
| **Status** | Implemented |
| **Scope** | DashboardPage mobile experience |

### Decision

On mobile (`useIsMobile()` returns true), the full calendar grid (week view, month view, agenda view, Mark Busy mode, calendar navigation) is entirely removed and replaced with a compact "Upcoming Hangouts" chronological list. Desktop is unchanged.

### Rationale

- The hourly time-grid calendar on mobile had scroll conflicts and was hard to use on small screens.
- Users primarily care about their Slotted meetups on mobile, not raw calendar events.
- A glanceable list grouped by "This Week" / "Next Week" is faster to scan and more mobile-friendly.

### What Changed

- **DashboardPage.tsx**: Calendar section wrapped with `!isMobile`, new mobile-only `<div>` renders the upcoming hangouts list.
- **New `upcomingByWeek` useMemo**: Groups upcoming meetups by current and next calendar week (Sunday–Saturday boundaries).
- **"Calendar connected but no events" nudge**: Hidden on mobile (references Mark Busy which is gone).
- **"Connect calendar" CTA**: Mark Busy paragraph hidden on mobile.

### Product Principles Followed

- **Soft social dynamics**: Uses "pending" not "awaiting response", "confirmed ✓" not ✅ emoji.
- **No social pressure**: Empty state says "No hangouts coming up" — no counts like "0 hangouts".
- **Privacy-first**: Only shows Slotted meetup titles, no raw calendar event details.

