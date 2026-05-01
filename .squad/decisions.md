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


---

## Decision: UI Simplification Directives (Shari, 2026-03-05)

| Field | Value |
|---|---|
| **Author** | Shari Paltrowitz (via Copilot) |
| **Date** | 2026-03-05 |
| **Type** | User directive (product strategy) |
| **Status** | Proposed — awaiting implementation planning |

### Context

Beta feedback indicated the app feels overwhelming with too many clickable elements, decorative elements, and secondary features competing with the core value proposition (scheduling with friends).

### Decision

**Scope 1 (UI Simplification - v1):**
1. App is too "busy" — unclear what action to take on each page, too many clickable things
2. Too many emojis — keep only functional ones, remove decorative
3. Groups feature isn't necessary — selecting multiple friends already shows joint calendars, groups shouldn't be a separate concept

**Scope 2 (Expanded - v2, merged with Scope 1):**
1. Groups: shouldn't need a group to find times with multiple friends — just select them
2. Calendar view on dashboard doesn't add anything — consider removing
3. Strip app to what a user NEEDS to get started, remove distractions from additional features

### Rationale

Core UX principle: each page should have one clear primary action. Beta feedback shows the app needs to feel native and intuitive on first use, not overwhelming with features the user doesn't need yet.

### Related Decisions

- See **Design Decision: UI Simplification — Product Audit Results** for detailed analysis and full product design recommendations

---

## Decision: Groups Feature Removal (Toph, 2026-03-05)

| Field | Value |
|---|---|
| **Author** | Toph (Lead/Architect) |
| **Date** | 2026-03-05 |
| **Type** | Architecture decision |
| **Status** | Proposed — awaiting user approval |

### Context

User feedback indicated the app feels "too busy," with specific callout that the groups feature is unnecessary since users can already select multiple friends and find joint availability without creating a formal group.

### Analysis

Full scope analysis of groups feature completed (see `docs/plans/research-groups-removal.md`):

1. **Groups feature is fully implemented** — 2 DB tables, 5 endpoints, extensive UI
2. **Multi-friend scheduling is independent** — the `GroupAvailability` component works with ANY friendIds array, not just saved groups
3. **Removal is clean** — no shared logic with core features. Groups are a pure add-on.
4. **Naming is misleading** — "GroupAvailability" component should be "MultiFriendAvailability"

### Decision

**RECOMMEND removing the groups feature entirely** while preserving multi-friend scheduling:

**Remove:**
- `friend_groups` and `friend_group_members` tables
- 5 group endpoints: `GET /groups`, `POST /groups`, `PUT /groups/:id`, `POST /groups/:id/members`, `DELETE /groups/:id`
- Group CRUD UI in FriendsPage (~400 lines of state/handlers/modals)
- `group_id` column on `pending_invites`
- 4 group notification types
- `SavedGroup` interface and `fetchGroups()` query

**Keep (with rebrand):**
- Multi-friend scheduling flow: select 2+ friends → find times → book
- `GroupAvailability` component (rename to `MultiFriendAvailability`)
- `/availability/group-overlap` endpoint (rename to `/availability/multi-friend`)
- POST `/meetups` with `friendIds[]` support

**Impact:**
- **Users:** All saved groups deleted. Can still schedule with multiple friends, just can't save those collections.
- **Code:** ~600 lines removed total (frontend + backend), 2 tables dropped, simpler UX
- **Risk:** Pending invites with `group_id` must be handled in migration

### Alternatives Considered

1. **Keep groups but improve UX** — Rejected. Adds complexity for marginal value.
2. **Remove UI but keep backend** — Rejected. Dead code is technical debt.
3. **Deprecate gradually** — Rejected. User base is small (early access), clean break is better.

---

## Design Decision: UI Simplification — Product Audit Results (Suki, 2026-03-05)

| Field | Value |
|---|---|
| **Author** | Suki (Designer) |
| **Date** | 2026-03-05 |
| **Type** | Design decision |
| **Status** | Awaiting review |

### Summary

Completed a full product design and user research audit for Slotted. The core finding is that the app's "aha moment" (finding overlapping free times with a friend) is buried under feature creep.

### Key Decisions Proposed

**1. Remove Groups Feature**
- Rationale: Duplicates multi-friend selection that already exists. Adds ~160 lines of UI complexity for marginal convenience of "saving" friend selections. Beta feedback explicitly called this out as unnecessary.
- Impact: Simpler FriendsPage, clearer mental model, reduced code surface.
- Related: See **Decision: Groups Feature Removal (Toph)** for full scope analysis

**2. Remove Dashboard Calendar View**
- Rationale: Users already have Google Calendar. The calendar view doesn't enable scheduling — it just displays information the user can see elsewhere. Removing it makes the "Find times with a friend" CTA more prominent.
- Impact: ~400 lines of code removed, cleaner dashboard, faster page load.
- Status: IMPLEMENTED (see **Decision: Replace Mobile Calendar Grid** and related dashboard cleanup)

**3. Consider Removing Events Page from V1**
- Rationale: Events (discovery, search, saved) is a "nice to have" that distracts from the core loop of scheduling with friends. Beta user Emma specifically noted the value is in group coordination, not event discovery.
- Recommendation: Defer to V2, or demote to secondary feature accessible only from Friends page.

**4. Simplify Information Architecture**
- Dashboard: 15 sections → 3 (Upcoming, Catch up, CTA)
- Notifications: 3 tabs → 1 unified list
- Settings: 4 tabs → 2 tabs
- Nav: 4 items → 3 (move Settings to menu)

**5. Emoji Reduction**
- Remove 24 decorative emojis that duplicate text labels
- Keep 84 functional emojis (state indicators, category icons, pickers)
- Full analysis: 108 emojis total identified in audit, see `docs/plans/research-product-design-audit.md`

### Full Analysis

See `docs/plans/research-product-design-audit.md` for complete rationale, page-by-page recommendations, feature tiers, and beta feedback integration.

---

## Decision: Workbox PWA Asset Caching via vite-plugin-pwa (Katara, 2026-03-05)

| Field | Value |
|---|---|
| **Author** | Katara (Frontend Dev) |
| **Status** | Implemented |
| **Scope** | PWA offline caching, service worker architecture |

### Decision

Use `vite-plugin-pwa` with `generateSW` mode and `importScripts` to add Workbox-based asset caching while coexisting with the existing Firebase Messaging service worker.

### Key Choices

1. **`generateSW` over `injectManifest`** — simpler config, no custom SW file to maintain. Workbox generates the entire SW from `vite.config.ts` options.
2. **`importScripts('./firebase-messaging-sw.js')`** — the generated `sw.js` imports Firebase messaging code. One SW handles both caching and push notifications.
3. **`serviceWorkerRegistration` passed to `getToken()`** — prevents Firebase from registering a second SW. Both systems share the Workbox-managed registration.
4. **`manifest: false`** — we already have `public/manifest.json`, no auto-generation needed.
5. **Route order matters** — NetworkOnly rules for auth/calendar endpoints are registered before the general `/api/` StaleWhileRevalidate rule.

### Caching Strategies

| Resource | Strategy | Config |
|----------|----------|--------|
| JS/CSS/HTML bundles | Precache (26 entries) | Auto from build output |
| Images/fonts/icons | CacheFirst | 100 entries, 30-day expiry |
| /api/* (non-calendar) | StaleWhileRevalidate | 50 entries, 5-min expiry |
| Firebase Auth endpoints | NetworkOnly | Always fresh |
| /api/calendar/* | NetworkOnly | Always fresh |
| Google Calendar API | NetworkOnly | Always fresh |
| Navigation requests | NetworkFirst | 3s timeout, cache fallback |

### Files Changed

- `client/vite.config.ts` — Added VitePWA plugin with full Workbox config
- `client/src/main.tsx` — Added `registerSW({ immediate: true })` for auto-update
- `client/src/vite-env.d.ts` — Added `vite-plugin-pwa/client` type reference
- `client/src/hooks/usePushNotifications.ts` — Pass Workbox SW registration to Firebase `getToken()`
- `client/package.json` — Added `vite-plugin-pwa` devDependency

### Build Output

- `build/sw.js` — Generated Workbox service worker
- `build/workbox-*.js` — Workbox runtime library
- `build/firebase-messaging-sw.js` — Copied from public/, imported by sw.js


---

## Decision: Strict Emoji Policy — Text First, Emojis Must Earn Their Place (Suki, 2026-03-05)

| Field | Value |
|---|---|
| **Author** | Suki (Designer) |
| **Date** | 2026-03-05 |
| **Status** | Proposed |
| **Triggered by** | Shari feedback that 84 "functional" emojis is still too many |

### Decision

Flip the default emoji stance from "keep functional emojis" to **"use text/icons by default, emojis must pass a 4-criteria test."**

### The 4-Criteria Test

An emoji earns its place ONLY if ALL are true:
1. Communicates something text alone cannot convey as quickly
2. Not redundant with an adjacent text label
3. Not one of many in a set where text labels work just as well
4. Removing it would genuinely make the UI harder to understand

### Result

- **100 → 13 unique emojis** (87% reduction)
- **678 → ~45 instances** (93% reduction)
- Only keep: traffic-light status (🟢🟡🔴), checkmarks (✅✓✕), star (⭐), warning (⚠️), heart (❤️), hourglass (⏳)
- Replace all emoji+text label pairs with text-only buttons/pills
- Replace notification type emojis with colored dots (already have colored backgrounds)

### Companion Decision: How It Works → /help page

Move Dashboard and Events "How It Works" content to a dedicated `/help` page accessible from Settings. Dashboard becomes fully actionable on first load.

### Rationale

- Every emoji next to a text label fails the redundancy test
- Text pills are more scannable than emoji+text pairs at mobile sizes
- Major apps (Google Maps, Airbnb, Spotify) use text-first category filters
- Reduces cognitive load and visual noise significantly
- 13 remaining emojis are all universally understood status indicators

### Impact

- All page files need emoji removal/replacement
- Settings preference pickers need redesign (text pills)
- Notification type config needs update (colored dots)
- New `/help` route and page needed
- HowItWorks component removed from Dashboard and Events

### Full Details

See `docs/plans/research-product-design-audit.md` — sections "Revised Emoji Policy (Strict)" and "How It Works Relocation".

---

## Decision: User Directive — Stricter Emoji Policy & How It Works Relocation (Shari Paltrowitz, 2026-03-05)

| Field | Value |
|---|---|
| **Issued by** | Shari Paltrowitz (Product Owner) |
| **Date** | 2026-03-05 |
| **Status** | Directive |

### Directive

1. **Emoji audit must cut deeper** — 84 "functional" emojis is still too many. Default: text-first approach, emojis only if they earn their place.
2. **"How It Works" relocation** — Banners should exist (help users) but not inline on Dashboard/Events. Move to separate `/help` page, accessible from Settings and subtle "?" affordance.

### Rationale

- User feedback: Visual clutter from too many emojis even when "functional"
- Dashboard should be 100% actionable on first load, not teaching users how to use it

### Follow-Up

Suki's strict emoji audit (above) addresses this directive.

---

## Decision: Product Strategy — State-Aware Progressive Disclosure (Mai, 2026-03-05)

| Field | Value |
|---|---|
| **Author** | Mai (Product Strategist) |
| **Date** | 2026-03-05 |
| **Status** | Proposed — awaiting Shari's review |
| **Scope** | Dashboard architecture, feature visibility, Day 1 experience |

### Decision

The Dashboard and feature visibility should be **state-aware** — showing different content based on the user's stage in the product lifecycle, not a fixed layout for all users.

### Key Recommendations

1. **Dashboard should progressively unlock sections** based on user milestones (0 friends → 1 friend → first hangout → 3+ friends → active user), not show all sections to everyone
2. **Smart scheduling features (scores, rankings, emojis) should be hidden** until the AI has 2+ interactions of behavioral data
3. **First-time scheduling should use "How about Saturday 2pm?"** (single suggestion + book) rather than ranked lists of 8 options
4. **Events page should be removed from V1** entirely (not demoted, removed)
5. **Social Battery, Activity Feed, Hangout Logging form, and advanced settings** should be gated behind user milestones (friends count, hangout count, time on platform)
6. **Onboarding should be 1 step** (calendar connect only) — preferred times learned from behavior
7. **Dashboard header dual CTAs (Log + Invite)** should be replaced with a single contextual action

### Rationale

Beta feedback says the app is "too busy." The previous audit correctly identified what to cut but didn't go deep enough on WHEN remaining features should appear. The core insight: every feature is a Week 4 feature. Nothing is designed for Minute 1. A state-aware Dashboard is the single architectural change that solves this at the root.

### Impact

If implemented, a new user's first experience would be: OAuth → Connect Calendar → "Invite a friend" screen → Friend joins → "How about Saturday 2pm?" → Book → Done in under 3 minutes. Current path requires scrolling past 10+ sections and processing 297 buttons.

### Source Document

`docs/plans/research-product-strategy-review.md`

---

## Decision Disagreements: Designer vs. Strategist (Suki–Mai, 2026-03-05)

**Context:** Suki (Designer) reviewed Mai's product strategy critique and identified three points requiring team decision-making. Both agents agree on the broader architectural direction (state-aware Dashboard, Day 1 focus) but differ on specific implementation details.

### 1. Notifications: Full Elimination vs. Lightweight Fallback

| Perspective | Position | Rationale |
|---|---|---|
| **Mai (Strategist)** | Kill Notifications page entirely. Show all actionable items as **inline banners** on relevant pages (friend requests on Friends page, meetup RSVPs on Dashboard). | Banners are contextual and reduce page fragmentation. Less is more for Day 1. |
| **Suki (Designer)** | Kill the Notifications *page* (agreement). Keep a **lightweight dropdown/sheet** accessible via nav bell icon for fallback. | Inline banners scale to ~1–2 items. With 5+ pending items in a week (multiple friend invites + hangout RSVPs), banners become a wall of cards before user reaches actual content. Dropdown catches high-activity scenarios without a full page. |

**Decision Required:** Full kill, or keep dropdown fallback?

---

### 2. First-Time Scheduling: Minimal Escape Hatch vs. Expandable Section

| Perspective | Position | Rationale |
|---|---|---|
| **Mai (Strategist)** | "How about Saturday at 2pm?" with a small **"See other times →" link**. Minimal visual weight on escape hatch. | Reduces decision fatigue. One suggestion mimics real friends. Most users accept first suggestion; escape hatch is secondary. |
| **Suki (Designer)** | Same single suggestion, but escape hatch as a **collapsed "Other times that work" section** below the Book button (not a navigation link). Expandable inline without leaving screen. | Control-oriented / planner users feel restricted by single suggestion. More visual weight on escape hatch respects user autonomy. After first hangout, switch to full list (Mai's Option A). |

**Decision Required:** Small link, or expandable inline section?

---

### 3. Help Resources: Complete Removal vs. Discoverable Fallback

| Perspective | Position | Rationale |
|---|---|---|
| **Mai (Strategist)** | Remove "How It Works" banner and `/help` page entirely. **App should be self-explanatory.** No inline teaching or external help resources. | Help page is a symptom of poor UX. If the app needs explaining, the design failed. No compromise. |
| **Suki (Designer)** | Kill the Dashboard "How It Works" banner (agreement). Kill inline Events teaching section (agreement). **Keep a discoverable `/help` page** linked from Settings + subtle "?" icon in header. | App can be self-explanatory AND have a help resource. Costs zero screen real estate (hidden by default). Catches the ~5% of edge-case confused users at 11pm who would otherwise uninstall. Pragmatism over ideology. |

**Decision Required:** Zero help resources, or hidden-but-available help?

---

**Source Documents:**
- `docs/plans/suki-response-to-mai.md` (full context and Suki's reasoning)
- `.squad/decisions/inbox/suki-mai-disagreements.md` (decision matrix)

---

## Decision: Backend API Accepts Both camelCase and snake_case (Zuko, 2026-03-05)

**Author:** Zuko (Backend Dev)  
**Date:** 2026-03-05  
**Status:** Applied (E2E fixes)  

### Decision

All Express endpoints now accept both camelCase and snake_case for request body fields to support multiple client conventions and test clients. GET /friends response includes both `id` and `friendshipId` plus raw DB fields. PATCH /friends endpoint accepts `{ status: "accepted" }` as an alias for `{ action: "accept" }`.

### Examples

- `friendIds` / `friend_ids`
- `startTime` / `start_time`
- `memberIds` / `member_ids`

### Rationale

Test client and potential future clients naturally use snake_case to match database column names. Rather than enforcing one convention, the backend is permissive on input and consistent on output, reducing friction across the ecosystem.

### Impact

- **Sokka (QA):** Fixes enable 12–16 of the remaining 16 E2E test scenarios (after migration applied)
- **Katara (Frontend):** No changes needed; camelCase calls continue to work
- **Toph (Schema):** `manual_busy_blocks` migration must be applied in Supabase

### Files Changed

- `functions/src/index.ts` — POST /groups, PATCH /friends, GET /friends, POST /meetups, POST /events/save
- `migrations/add_manual_busy_blocks.sql` — New migration for busy blocks table + RLS

---

## Decision: E2E Test Infrastructure Fixes (Sokka, 2026-03-05)

**From:** Sokka (QA)  
**Date:** 2026-03-05  
**Status:** Applied

### Summary

Fixed 22 test failures (53→75 passing, 94% pass rate) in the E2E agent test suite. All fixes were infrastructure and test-client logic — no backend changes (though Zuko's backend compatibility fixes are prerequisites).

### What Changed

**Test Client Fixes** (`tests/agents/src/client.ts`):
- `acceptFriendship` / `declineFriendship`: Send `{ action: "accept" }` matching backend (was `{ status: "accepted" }`)
- `createMeetup`: Send camelCase keys (`friendIds`, `startTime`, `endTime`)
- `createGroup`: Send `memberIds` (camelCase)
- `getFriends()`: Map `friendshipId` → `id` for response normalization

**Polling Infrastructure** (`tests/agents/src/scenario.ts`):
- Added `waitFor<T>()` helper — retries async checks up to N times with delay
- Used for all notification assertions depending on backend-side async processing

**Scenario Fixes**:
- **friends.ts**: Polling for notifications; scoped duplicate check to per-sender
- **meetups.ts**: Polling for meetup_request and meetup_confirmed notifications
- **notification-dedup.ts**: Use `friend.id` instead of `user_a_id/user_b_id`; polling for notifications
- **calendar-events.ts**: Added required `id` field to test event; polling for saved events list

### Remaining Blockers (5 test failures)

These are backend issues, not test bugs:

1. **Missing `manual_busy_blocks` table** (3 failures) — Backend references the table but it doesn't exist in the database. Needs migration application.
2. **Authorization gap in DELETE /groups** (1 failure) — Returns 200 for non-creator members (expected 403 or 404).

### Key Learnings

**Critical pattern:** Always match client payload keys to backend `req.body` destructuring. Backend uses camelCase for meetups/groups (`friendIds`, `startTime`, `memberIds`) and snake_case for busy-blocks (`start_time`, `end_time`). No consistency — must inspect each endpoint.


---

## Decision: Phase 1 Frontend Removals (Katara, 2026-07)

**Author:** Katara (Frontend Dev)  
**Date:** 2026-07  
**Status:** Implemented

### What was removed

1. **Groups feature** — entirely removed from FriendsPage, queries.ts. GroupAvailability component still exists but is no longer invoked through saved groups.
2. **Events route** — `/events` route and EventsPage import removed from App.tsx. Files (`EventsPage.tsx`, `EventSharePage.tsx`) preserved. EventSharePage public route (`/e/:code`) kept.
3. **Calendar view** — desktop calendar grid (week/month/agenda), mark-busy mode, and all related state/handlers removed from DashboardPage. Calendar data still fetched for header summary.
4. **HowItWorks banner** — rendering removed from DashboardPage. Component preserved for future /help page.
5. **Score emojis** — `scoreEmoji()` function and 🔥👍🤔😐 display removed from FriendAvailability, GroupAvailability, and EventsPage. Numeric score badge removed from time slot components.

### What was kept

- `GroupAvailability.tsx` component (accepts `friendIds[]`, works without saved groups)
- `AddToCalendarModal` and `calendarModal` state (part of meetup confirmation flow, not the calendar view)
- Calendar data fetching (14 days) for DashboardPage header summary
- `HowItWorks` function definition (will be repurposed)
- `EventsPage.tsx` and `EventSharePage.tsx` files
- `scoreColor()` in EventsPage (different context: event-friend match quality)
- Mobile "Upcoming Hangouts" section on DashboardPage

### Backend impact

Groups endpoints (`GET/POST/PUT/DELETE /groups`, `POST /groups/:id/members`) still exist on the backend — frontend no longer calls them. Backend cleanup is a separate task for Zuko.

---

## Decision: Phase 1 Groups Backend Removal (Zuko, 2026-03-05)

**Author:** Zuko (Backend Dev)  
**Date:** 2026-03-05  
**Status:** Implemented — pending migration execution

### What Changed

Removed all 5 group CRUD endpoints from `functions/src/index.ts` (~434 lines). Renamed `/availability/group-overlap` to `/availability/multi-friend-overlap` — the core multi-friend scheduling logic is preserved, only the route name changed.

### Frontend Impact

- **Katara must update** the API call in `GroupAvailability.tsx` (line 46) from `/availability/group-overlap` to `/availability/multi-friend-overlap`.
- All group-related API calls (`fetchGroups`, create/delete/update group mutations) will now 404. Frontend code for these should be removed.

### Migration Pending

`migrations/remove_groups.sql` is created but NOT executed. It drops `friend_groups`, `friend_group_members`, and removes `group_id` from `pending_invites`. **Toph must review before execution** since it involves schema changes.

### Key Decision: Keep `scoreGroupOverlaps` function name

The internal helper `scoreGroupOverlaps()` was NOT renamed because it's called by both the 1-on-1 `scoreOverlaps()` wrapper and the multi-friend endpoint. Renaming it would be a cosmetic-only change with risk of introducing bugs. Can be renamed in a future cleanup pass.


---

## Decision: Phase 2A UI Simplification (Katara, 2026-07)

**Author:** Katara (Frontend Dev)  
**Date:** 2026-07  
**Status:** Implemented

### Notifications are now a dropdown, not a page
- `NotificationsPage.tsx` preserved but disconnected from nav (still routable at `/notifications` for deep links and push notification tap targets)
- `NotificationDropdown.tsx` created in `components/` — renders as bottom sheet on mobile, dropdown on desktop
- All notification actions (RSVP, friend requests, counter-propose) work inline in the dropdown
- AppShell now fetches notifications for the unread count badge

### Settings is a single scrollable page with accordion
- Removed the 4-tab navigation (`profile`, `about`, `in-person`, `calls`)
- New layout: Calendar (top) → Account → Advanced (collapsed)
- Advanced accordion starts collapsed — most users never need to open it
- Calendar is first because it directly impacts core experience

### Bottom nav reduced to 2 tabs
- Mobile: Home + Friends only
- Header: [Logo] ... [Bell icon] [Profile avatar → Settings]
- Desktop: Home, Friends, Settings in top nav bar (3 links)
- Sign out button moved from header to Settings > Account section

### Cross-Agent Impact
- None — all changes are frontend-only, no API or schema changes
- Push notification deep links to `/notifications` still work

---

## Decision: Phase 2B UI Simplification (Katara, 2026-07)

**Author:** Katara (Frontend Dev)  
**Date:** 2026-07  
**Status:** Implemented

### FriendsPage cards replaced with list rows
- Removed friend categorization (local/long-distance), interest badges, calendar sync indicators, hangout cadence display
- Each friend is now a single row: avatar (36px) + name + "last seen" caption + chevron
- Added multi-select mode via long-press or "Select" toggle for batch "Find time" scheduling
- Added "+ Invite a friend" row at bottom of list
- Changed "Decline" to "Not now" for incoming friend invites (soft social language)

### Onboarding reduced from 3 steps to 1
- Removed step 2 (city selection) and step 3 (preferred times)
- Single screen: welcome message + calendar connect
- "Continue" button appears only after calendar is connected
- Backend mutation sends empty `preferredTimes` array — no backend change needed

### Help page created at /help
- Repurposed HowItWorks content into 4 numbered steps
- Accessible from Settings page (link after feedback section)
- Protected route — requires authentication

### Strict 8-emoji policy enforced
- Only 🟢🟡🔴✅⏳⭐⚠️❤️ allowed across all frontend files
- Decorative emojis in option arrays replaced with nothing or styled number badges
- Applied to all pages and components (20+ files affected)

### Cross-Agent Impact
- None — all changes are frontend-only, no API or schema changes
- Onboarding mutation still sends to same endpoint, just with empty preferredTimes

---

## Decision: Phase 3 — Progressive Dashboard Architecture (Katara, 2026-03-05)

| Field | Value |
|---|---|
| **Author** | Katara (Frontend Dev) |
| **Date** | 2026-03-05 |
| **Status** | Implemented |
| **Scope** | Phase 3 Dashboard Refactor |

### Decision

DashboardPage now renders different full-screen experiences based on a `UserStage` computed from existing data (calendar connection, friend count, pending invites, hangout counts). The stage logic lives in `client/src/lib/userStage.ts` as a pure function.

### Rationale

All three designers (Ty Lee, Suki, Mai) agreed the Dashboard should reflect reality — not show empty sections with headers. The progressive approach means Day 1 users see a single invite CTA (not 15 empty widgets), while active users see upcoming hangouts and reconnect suggestions.

### What Changed

- `client/src/lib/userStage.ts` — new file, 6-stage type union + pure function
- `client/src/pages/DashboardPage.tsx` — full rewrite, 1341 → ~370 lines
- Removed: calendar view, activity feed, event suggestions, saved events, hangout history/log form, HowItWorks, all related state/mutations
- Kept: dashboard/friends/meetups queries, friend action mutation, AddToCalendarModal

### Impact

- **No backend changes needed** — all data already fetched by existing queries
- **FriendsPage unaffected** — scheduling flow still works via `/friends?findTimes=<id>`
- **NotificationDropdown unaffected** — bell icon still in AppShell
- **Activity feed, event suggestions, saved events queries** still exist in queries.ts but are no longer imported by DashboardPage. They may be used elsewhere or can be cleaned up later.

### Trade-offs

- The "Log hangout" form and hangout history section were removed from Dashboard. If needed, they could be added to a dedicated History page or under Settings.
- Event suggestions/saved events are no longer surfaced on Dashboard. If Events returns in V2, it would get its own surface.

---

## Decision: Phase 4 — Single-Suggestion Scheduling, Star Rating, Social Battery Gating (Katara, 2026-03-05)

| Field | Value |
|---|---|
| **Author** | Katara (Frontend Dev) |
| **Date** | 2026-03-05 |
| **Status** | Implemented |
| **Scope** | Phase 4 UX Improvements |

### Decisions

#### completedHangouts derived client-side from meetups query

Rather than adding a new backend endpoint, all three Phase 4 features derive `completedHangouts` count from the existing `fetchMeetups` query (filtering by `end_time < now` and confirmed/accepted status). This means FriendsPage, DashboardPage, and SettingsPage all share the same cached `queryKeys.meetups` data — no extra network calls.

#### Star rating uses localStorage for dismiss tracking

Rated/dismissed meetup IDs are stored in `localStorage` under `slotted_rated_meetups` to avoid re-prompting. This is intentionally ephemeral — if a user clears storage, they may see a rating prompt again, which is acceptable. No new backend "has_been_rated" column was added.

#### Social Battery defaults to "open" for hidden state

While the Social Battery UI is hidden (< 3 hangouts), the backend default of `2-3-week` for `social_frequency` still applies to scheduling. The user just can't see or change it yet. This avoids needing a separate default-setting mechanism.

### Key Changes

- `client/src/components/StarRating.tsx` — New interactive star picker for rating completed hangouts
- `client/src/pages/FriendsPage.tsx` — Single-suggestion scheduling for users with no hangouts
- `client/src/pages/SettingsPage.tsx` — Social Battery UI gated behind `completedHangouts >= 3`

### Impact

- **No backend changes required** — all data derived client-side
- **One new component** — StarRating; reusable for future rating flows
- **FriendsPage UX improved** — First-timers see simpler, single-suggestion flow vs. multi-slot picker

---

## Decision: Settings Cleanup & Sign Out to Header (2026-03-05T19:57:27Z)

**Author:** Katara (Frontend Dev) + Shari Paltrowitz (Product)  
**Date:** 2026-03-05  
**Status:** Implemented

### What Changed

1. **SettingsPage reduced to 2 sections + feedback:** Calendar → Advanced accordion → Feedback. Removed: Account section (display name editing, sign out), Event Interests (backlogged), Default hangout length, Default call length.

2. **Sign Out moved to AppShell header dropdown:** The profile avatar in the top-right corner is now a dropdown menu with "Settings" and "Sign out" options. Previously it was a direct link to /settings with sign out only available inside the Settings page.

3. **Mobile bottom nav updated:** Added gear icon (⚙️) as 3rd tab to ensure Settings access from mobile. Desktop nav unchanged.

4. **Notifications panel fixed on mobile:** Changed positioning from `bottom-0` to `top-14 bottom-0` to account for AppShell header height and ensure panel is visible.

### Why

- Event Interests, hangout length, and call length are being backlogged — no need to show UI for unused features.
- Sign out should be accessible from any page, not buried in Settings.
- Account section was removed since sign out was its primary action; display name editing can be re-added later if needed.
- Mobile users needed consistent settings access via bottom nav.
- Notifications panel was off-screen on mobile, making it inaccessible.

### Team Review (2026-03-05T19:57:27Z)

#### Suki (Designer)
- Validated removal scope — no excessive whitespace. Section density appropriate.
- Confirmed avatar-to-dropdown interaction is accessible.
- No functionality uses `preferredDuration`, `preferredCallDuration` — safe to remove.

#### Ty Lee (UI Designer)
- Recommended killing explicit Save button — settings should auto-persist.
- Recommended flattening Advanced accordion (nested accordions less clear).
- Recommended extracting Feedback section to external link or separate page.
- Recommended styling Sign Out as destructive (red/pink text) for visual distinctiveness.

#### Mai (Product Strategist)
- Confirmed all removals correct — not connected to active features.
- Found that `preferredDuration` feeds scheduling algorithm but users always hit defaults anyway.
- Recommended learning durations from actual meetup logs in future phase, not user prefs.
- Confirmed header placement is correct for account actions.

### Impact on Other Agents

- **Backend (Zuko):** The `PUT /users/me/settings` endpoint still accepts `preferredDuration`, `preferredCallDuration`, `eventInterests`, `eventCity`, and `displayName` fields — they're just no longer sent from the frontend. No backend changes needed, but these fields could be cleaned up later.
- **All agents:** Sign out is now accessible via the profile dropdown in the AppShell header on every page.

### Pending Polish Recommendations

- [ ] Remove explicit Save button — auto-persist on change
- [ ] Flatten Advanced accordion into flat toggleable sections
- [ ] Extract Feedback to external link or separate page
- [ ] Style Sign Out as destructive action (red/pink text)

These recommendations await user approval and will be tracked separately.

---

## Decision: First-Name-Only Display Names (Katara, 2026-03-05)

| Field | Value |
|---|---|
| **Author** | Katara (Frontend Dev) |
| **Date** | 2026-03-05 |
| **Status** | Implemented |
| **Scope** | MVP User-Facing Names |

### What

All user-facing display names across the frontend now show first name only (e.g., "Shari" instead of "Shari Paltrowitz"). Full names remain in database.

### How

- New utility `getFirstName()` in `client/src/lib/utils.ts` — splits on space, returns first token, handles null/undefined/empty
- Applied at every render site; full names remain in DB, API responses, and meetup-log payloads
- Replaced all ad-hoc `.split(' ')[0]` patterns with the centralized utility

### Why

- Friendlier, more casual tone — matches Slotted's social product identity
- Privacy improvement — less personal info shown on screen at a glance
- "Shari" feels warmer than "Shari Paltrowitz" for a friendship app

### Affected Files

DashboardPage, FriendsPage, InvitePage, EventSharePage, OnboardingPage, NotificationsPage, NotificationDropdown, FriendAvailability, GroupAvailability.

---

## Decision: Homepage Friend Avatar Row Replaces Single-Friend CTA (Katara, 2026-07)

**Author:** Katara (Frontend)  
**Date:** 2026-07  
**Status:** Implemented  
**Scope:** DashboardPage `first-hangout` stage

### Decision

The `one-friend` stage (renamed to `first-hangout`) now shows a horizontally scrollable row of ALL accepted friend avatars instead of a single-friend "Find times with {name} →" CTA. Friends are sorted alphabetically by first name. Tapping any avatar navigates to `/friends?findTimes={id}`.

### Rationale

The old CTA only showed the most recently added friend, which was misleading for users with multiple friends (e.g., Shari has 10). The avatar row presents all options equally with no ranking or social pressure — consistent with Slotted's design principles.

### Files Changed

- `client/src/lib/userStage.ts` — renamed `one-friend` → `first-hangout`
- `client/src/pages/DashboardPage.tsx` — replaced `StageOneFriend` with `StageFirstHangout`

---

## Decision: Settings Auto-Save & Feedback Extraction (Katara, 2026-07)

| Field | Value |
|---|---|
| **Author** | Katara (Frontend) |
| **Date** | 2026-07 |
| **Status** | Implemented |
| **Scope** | SettingsPage, FriendsPage, AppShell, FeedbackButton |

### Changes

1. **Settings auto-save:** Replaced explicit Save button with 800ms debounced auto-save. Uses `useCallback` + `useEffect` with a `settingsLoaded` ref guard to avoid saving on mount.
2. **Advanced section flattened:** Always-visible with divider heading instead of accordion.
3. **Feedback extracted to FeedbackButton.tsx:** Floating action button in AppShell, renders modal on click. Same API call (`POST /feedback`).
4. **FriendsPage checkboxes:** Multi-select mode now shows explicit checkboxes + count header.
5. **Sign Out styled red** in AppShell dropdown to signal destructive action.

### Rationale

Settings auto-save reduces friction — users don't forget to hit Save. Feedback as a floating button is globally accessible, not buried in settings. Checkboxes make multi-select mode unmistakable.

---

## Decision: Settings & Friends UI Improvements (Katara, 2025-01-24)

**Agent:** Katara (Frontend Dev)  
**Date:** 2025-01-24  
**Status:** Implemented

### Context

Post-beta user feedback and design review (Ty Lee) identified 5 UX friction points:
1. Checkboxes hidden until multi-select mode → hard to discover
2. Save button in Settings → confusing when auto-save already works
3. Advanced section accordion → extra tap for common settings
4. Feedback section buried in Settings → low discoverability
5. Sign Out not visually distinct from other actions

### Decisions Made

#### 1. Checkboxes Always Visible (FriendsPage)
- **Decision:** Show checkboxes on left side of every accepted friend row
- **Rationale:** Improves discoverability of multi-select feature for group scheduling
- **Implementation:** 
  - Checkbox always rendered with interactive handlers (onChange + onClick)
  - Checking any box auto-enters select mode
  - Unchecking all boxes auto-exits select mode (new useEffect)
  - Prevents row click-through with stopPropagation

#### 2. Remove Save Button (SettingsPage)
- **Decision:** Remove "Save Changes" gradient button from header
- **Rationale:** Auto-save with 800ms debounce already works; button creates confusion about when changes persist
- **Implementation:** 
  - Removed button from header JSX
  - Kept `autoSaveIndicator` ("Saved ✓") as subtle confirmation
  - Debounced auto-save continues unchanged

#### 3. Advanced Section (SettingsPage)
- **Decision:** Keep as-is (already flat)
- **Finding:** Advanced section had no accordion state or toggle button — was already statically rendered
- **No changes needed**

#### 4. Feedback Button (AppShell)
- **Decision:** Keep as-is (already extracted)
- **Finding:** FeedbackButton.tsx already exists as floating button in AppShell (line 238)
- **No changes needed**

#### 5. Destructive Sign Out Styling (AppShell)
- **Decision:** Strengthen red color to emphasize destructive action
- **Rationale:** Sign out is a high-consequence action; should be visually distinct from other menu items
- **Implementation:** 
  - Text color: `text-red-500` → `text-red-600`
  - Icon color: `text-red-400` → `text-red-500`
  - Kept soft hover: `hover:bg-red-50` (no harsh red background)

### Team Impact

- **Zuko (Backend):** No backend changes required
- **Ty Lee (Design):** All changes approved via design review
- **Suki (Content):** No copy changes needed
- **Toph (Infra):** No infrastructure impact

### Files Modified

- `client/src/pages/FriendsPage.tsx` — Checkbox always-visible + auto-mode logic
- `client/src/pages/SettingsPage.tsx` — Removed Save button
- `client/src/components/AppShell.tsx` — Stronger destructive colors on Sign Out

### Validation

- ✅ TypeScript type check passes (`npx tsc --noEmit`)
- ✅ No new dependencies
- ✅ Follows existing Slotted design patterns (soft social dynamics, slotted-* tokens)
- ✅ No breaking changes to backend API contracts

---

## Decision: Deduplicate friend_accepted notifications (post-groups-removal) (2026-04-20)

| Field | Value |
|---|---|
| **Author** | Copilot (via Shari Paltrowitz) |
| **Date** | 2026-04-20 |
| **Status** | Implemented |
| **Scope** | Notification deduplication — `friend_accepted` on referral signup |
| **Supersedes** | 2026-03-04 decision on notification dedup index scope |

### Context

Two independent code paths both emitted a `friend_accepted` notification to the referrer when a new user signed up via an invite/referral link:

1. **`POST /users/me`** — pending-invites auto-connect loop creates `"New friend joined!"` (no `relatedId`).
2. **`POST /friends/connect-referral`** — explicit referral connect creates `"New friend connected!"` (with `relatedId`).

Because the two notifications had different titles, bodies, and `relatedId` values, the app-level dedup in `createNotification()` (1-hour window on `related_user_id`) failed to catch them. Firebase Function race conditions (separate instances, Supabase read-replica lag) allowed both INSERT paths to succeed.

The 2026-03-04 migration (`deduplicate_notifications.sql`) intentionally excluded `friend_accepted` from a DB-level unique index because that type was overloaded for group-membership events. Groups have since been removed (see `docs/plans/research-groups-removal.md`), making that rationale stale.

### Decision

1. **Remove the `createNotification` call from `POST /friends/connect-referral`** — `POST /users/me`'s pending-invites loop is the single authoritative writer for "inviter notified when invitee signs up." The `connect-referral` endpoint is now idempotent and non-notifying.
2. **Add a partial unique DB index on `friend_accepted`** — `(user_id, type, related_user_id) WHERE type = 'friend_accepted' AND related_user_id IS NOT NULL`. The existing 23505 error handler in `createNotification()` cleanly absorbs any race-condition collisions.

### Files Changed

- `functions/src/index.ts` — removed `createNotification` block from `POST /friends/connect-referral` (~line 1651)
- `migrations/deduplicate_friend_accepted.sql` — new migration: cleanup DELETE + partial unique index

---

## Architecture & Privacy Audit Findings — Toph (2026-04-30)

| Field | Value |
|---|---|
| **Author** | Toph (Lead) |
| **Date** | 2026-04-30 |
| **Status** | Findings — awaiting remediation sign-off |
| **Scope** | Full-spectrum security, privacy, and vulnerability audit |
| **Severity** | 5 Critical, 7 High |

### Context

Full end-to-end security audit of Slotted codebase. Toph conducted architecture-level review of authentication, data privacy, RLS policies, and infrastructure patterns.

### Critical Issues (Block Deployment)

1. **OAuth tokens stored in plaintext** — Google, Outlook, Apple credentials unencrypted in `users` table. Must encrypt with AES-256-GCM or move to vault.
2. **Social Battery leaks to friends** — `/dashboard` endpoint includes `social_battery` in friend data. Violates core privacy principle.
3. **Hardcoded developer email** in `AuthContext.tsx:65` — PII shipped to production.
4. **protobufjs RCE vulnerability** — npm audit critical, arbitrary code execution.
5. **Zero RLS policies defined** — All 18 tables have RLS enabled but no policies. Backend service-role bypasses this, but one architectural change exposes everything.

### High Issues (Fix This Sprint)

6. **Calendar overlap endpoint syncs before checking friendship** — Resource-intensive sync fires before authorization.
7. **Meetup share codes too short** — 3-char minimum is brute-forceable in ~26 hours.
8. **Account enumeration via /friends/invite** — Different responses reveal if email exists.
9. **Race condition on meetup auto-confirm** — Concurrent accepts can miss "all accepted" state.
10. **10 high-severity npm vulnerabilities** — axios SSRF, vite path traversal, rollup file write.
11. **Apple password transmitted in plaintext JSON** — Only HTTPS protects it.
12. **Axios interceptor has no error handler** — Failed token fetch → unauthenticated request proceeds.

### Architecture Decisions Required

- **Token encryption strategy**: Supabase Vault vs application-layer encryption vs external KMS?
- **RLS policy strategy**: Define policies defensively now, or document service-role-only as intentional?
- **Share code format**: Switch to UUID-based (12+ char) codes?
- **Meetup confirmation logic**: Move to database trigger to eliminate race condition?

### Delegation

- **Zuko (Backend)**: Fix items 1, 2, 6, 7, 8, 9, 12 (backend security)
- **Katara (Frontend)**: Fix items 3, 4, 10, 11, 12 (client security)
- **Sokka (Tester)**: Validation and edge case testing

### Priority Order

| Priority | Items | Effort |
|----------|-------|--------|
| P0 (Today) | 2, 3, 4 | 1-2 hours |
| P1 (This week) | 1, 5, 6, 8, 10, 12 | 8-12 hours |
| P2 (Next sprint) | 7, 9, 11 | 4-6 hours |

---

## Backend Security & API Audit Findings — Zuko (2026-04-30)

| Field | Value |
|---|---|
| **Author** | Zuko (Backend) |
| **Date** | 2026-04-30 |
| **Status** | Findings — awaiting remediation sign-off |
| **Scope** | Backend authentication, API security, token handling |
| **Severity** | 2 Critical, 3 High, 3 Medium |

### Context

Comprehensive backend security audit of `functions/src/index.ts`, database schema, and API architecture. Focus on authentication, OAuth token storage, and authorization patterns.

### Critical Findings Requiring Team Action

#### 1. CRITICAL: Admin Secret Hardcoded as Default (Line 9337)

```javascript
const ADMIN_SECRET = process.env.ADMIN_SECRET || "slotted-admin-2026";
```

If `ADMIN_SECRET` env var is not set, any attacker can access all admin endpoints with the default string. This gives full read access to ALL user data, notifications, tokens, etc.

**Decision Needed:** Remove the hardcoded fallback. Fail loudly if env var is missing (like other required vars).

#### 2. CRITICAL: OAuth Tokens Stored in Plaintext (Lines 43–58, schema.sql)

Google, Apple, and Outlook OAuth tokens (access + refresh) are stored as plaintext TEXT columns in the users table. A database breach exposes calendar access for every user.

**Decision Needed:** Implement at-rest encryption for `google_refresh_token`, `google_access_token`, `apple_caldav_password`, `outlook_refresh_token`, `outlook_access_token`. This was previously flagged but never addressed.

#### 3. HIGH: OAuth Callback Has No CSRF Protection (Lines 6744, 7432)

`GET /calendar/callback` and `GET /calendar/outlook/callback` use `state` parameter as Firebase UID. An attacker could craft a callback URL with their own `state` pointing to a victim's UID, associating the attacker's Google/Outlook account tokens with the victim's Slotted profile.

**Decision Needed:** Use a signed or random `state` token stored in a temporary table, not bare Firebase UIDs.

#### 4. HIGH: Apple CalDAV Credentials Stored in Plaintext (Line 7244)

`apple_caldav_password` (app-specific password) is stored directly in the DB without encryption. Combined with the service-role key bypass, this is a high-value target.

**Decision Needed:** Encrypt at rest, same solution as #2.

### Medium Findings

5. **In-Memory Rate Limiter Resets on Cold Start** — On Firebase Functions with `maxInstances: 10`, each instance has its own counter. An attacker can bypass rate limits by distributing requests across instances.
6. **Suggestion friendId Not Validated as Friend** — `GET /suggestions/:friendId` does not verify the friendId is an accepted friend.
7. **`getDbUser` Returns `select("*")`** — The helper fetches ALL columns including tokens. While `stripSensitive` is used at response boundaries, internal code paths could leak the user object.

### Architecture Positives (No Action Needed)

- ✅ Firebase Auth (`requireAuth`) applied to all protected routes
- ✅ Friendship checks before accessing other users' availability (IDOR protection)
- ✅ `meetup_participants` checked before meetup mutations
- ✅ Notification writes scoped to `user_id` = current user
- ✅ Supabase parameterized queries — no SQL injection risk
- ✅ RLS enabled on all tables
- ✅ Sensitive fields stripped from user profile responses
- ✅ CORS restricted to known origins
- ✅ Webhook secret validated on Google Calendar webhooks
- ✅ Public routes properly rate-limited and return minimal data

---

## Frontend Security & Optimization Audit Findings — Katara (2026-04-30)

| Field | Value |
|---|---|
| **Author** | Katara (Frontend) |
| **Date** | 2026-04-30 |
| **Status** | Findings — awaiting remediation sign-off |
| **Scope** | Frontend security, performance optimization, accessibility |
| **Severity** | 3 Critical, 3 High, 4 Medium (Accessibility), 0 Low |

### Context

Full audit of `client/src/` covering authentication flows, OAuth handling, credential storage, performance patterns, and accessibility standards.

### Critical Actions Required

#### 1. Remove Hardcoded Email (AuthContext.tsx:65)

`localStorage.setItem('slotted_referrer_email', 'sharipaltrowitz@gmail.com')` — personal email in production code. Remove immediately.

#### 2. Remove Sensitive Console Logs

- `AuthContext.tsx:261` — logs Apple Calendar username
- `AuthContext.tsx:263` — logs full Apple Calendar response
- `usePushNotifications.ts:55` — logs FCM token
- `usePushNotifications.ts:88` — logs full push payload
- `firebase-messaging-sw.js:24` — logs background message payload

#### 3. Firebase SW Placeholder Keys

`public/firebase-messaging-sw.js` has TODO placeholder API keys. Push notifications won't work in production until real keys are injected (ideally via build step, not hardcoded).

### High-Priority Decisions Needed

#### 4. Open Redirect in OAuth Flows

`AuthContext.tsx:236, 305` — `window.location.href = data.url` trusts server response without domain validation. **Decision:** Should we whitelist allowed redirect domains (google.com, microsoft.com)?

#### 5. Direct fetch() vs Axios Interceptor

`AuthContext.tsx:122-140` uses raw `fetch()` instead of the `api` client, bypassing the token interceptor. **Decision:** Standardize all API calls through `lib/api.ts`?

#### 6. FriendsPage Performance

`renderFriendRow` (line 193-260) creates new handler functions per row per render. Needs extraction to `React.memo` component. **Decision:** Prioritize this refactor?

### Accessibility Gaps (Team Awareness)

- **StarRating:** No ARIA roles, no keyboard navigation, color-only feedback
- **AddToCalendarModal:** No `role="dialog"`, no focus trap, no focus return
- **CalendarPicker:** Checkboxes lack `<label>` elements, no keyboard selection
- **FriendsPage:** `role="button"` elements lack full keyboard support (only Enter, not Space)

### TypeScript `any` Debt

12+ instances of `err: any` in catch blocks across: AuthContext, CalendarPicker, GroupAvailability, FriendAvailability, CounterProposePanel. Should be typed as `AxiosError` or `Error`.

### Security Verified Safe (No Action Needed)

- ✅ Auth tokens: Fresh `getIdToken()` per request via axios interceptor
- ✅ No XSS: No `dangerouslySetInnerHTML` anywhere
- ✅ Route protection: ProtectedRoute properly guards authenticated pages
- ✅ CSRF: Bearer token auth is inherently CSRF-resistant
- ✅ Environment vars: Firebase config uses `VITE_` prefix correctly
- ✅ PWA caching: NetworkOnly for auth endpoints
- ✅ Code splitting: All routes lazy-loaded with retry logic
- ✅ Soft social language: Verified across all user-facing copy

---

## Bug Testing & Edge Case Audit Findings — Sokka (2026-04-30)

| Field | Value |
|---|---|
| **Author** | Sokka (Tester) |
| **Date** | 2026-04-30 |
| **Status** | Findings — awaiting remediation sign-off |
| **Scope** | Bug testing, edge case audit, test coverage analysis |
| **Severity** | 4 Critical, 7 High, 9 Medium, 5 Low |

### Context

Comprehensive code audit of backend, database schema, and frontend with focus on edge cases, race conditions, input validation, and test coverage gaps. Audit of `functions/src/index.ts`, `database/schema.sql`, `client/src/`, and `tests/agents/src/scenarios/`.

### Critical Issues (Ship-Blocking)

#### CRIT-1: Outlook tokens NOT in SENSITIVE_FIELDS → leak to client

**Location:** `functions/src/index.ts:982-990`

`SENSITIVE_FIELDS` strips Google tokens and Apple credentials but **omits**:
- `outlook_access_token`
- `outlook_refresh_token`
- `outlook_token_expires_at`

The `GET /users/me` endpoint returns `stripSensitive(user)` — but `select("*")` fetches the full row (line 203). Any user who has connected Outlook will have their OAuth tokens returned to the browser.

**Impact:** Token theft allows full read/write access to a user's Outlook Calendar.

**Fix:** Add all three Outlook fields to `SENSITIVE_FIELDS`.

#### CRIT-2: No account deletion endpoint — GDPR/privacy risk

**Location:** Full codebase search — no `DELETE /users/me` or equivalent exists.

There is no way for a user to delete their account. The database has `ON DELETE CASCADE` on all FK references, so a simple user row delete would cascade correctly, but the endpoint doesn't exist. Apple App Store and GDPR both require this.

**Fix:** Add `DELETE /users/me` that: (1) deletes the Supabase user row (cascade handles rest), (2) deletes the Firebase Auth user, (3) revokes Google/Outlook OAuth tokens.

#### CRIT-3: Admin secret has hardcoded fallback in source code

**Location:** `functions/src/index.ts:9337`

```typescript
const ADMIN_SECRET = process.env.ADMIN_SECRET || "slotted-admin-2026";
```

If `ADMIN_SECRET` env var is unset (e.g., in a new deployment), anyone can call `/admin/migrate`, `/admin/users`, etc. with the public hardcoded value.

**Fix:** Remove the fallback. If env var is missing, `requireAdmin` should always reject.

#### CRIT-4: Friend list leaks email addresses of all friends

**Location:** `functions/src/index.ts:1382`

The `GET /friends` response includes `friend.email` for every friendship. This exposes personal email addresses to anyone who is a friend. Combined with the invite system, a malicious user could harvest emails.

**Fix:** Remove `email` from the friend response object, or only include it if the friend has opted in to sharing.

### High Issues

#### HIGH-1: No input length validation on any text field

**Location:** All POST/PUT/PATCH endpoints

No endpoint validates the length of `displayName`, `title`, `description`, `location`, `message`, `neighborhood`, etc. A user could submit a 10MB title string, causing DB storage bloat, slow rendering, and potential OOM on notification formatting.

**Fix:** Add length guards (e.g., `title.slice(0, 200)`, `description.slice(0, 2000)`).

#### HIGH-2: `GET /friends` returns `select("*")` on joined users — leaks all user columns

**Location:** `functions/src/index.ts:1314`

The query uses `users!friendships_user_a_id_fkey(*)` — fetching ALL columns from the joined user rows. While the response is manually mapped, the raw DB response in memory contains tokens, passwords, etc.

**Fix:** Explicitly select only needed columns in the join.

#### HIGH-3: Race condition in friend request upsert → overwrites declined status

**Location:** `functions/src/index.ts:1543-1547`

`POST /friends/invite` uses `upsert` with `onConflict: "user_a_id,user_b_id"`. If User B previously **declined** User A's request, User A can simply re-send the invite and the status is overwritten to `pending`.

**Expected:** A declined friendship should require the *declined* party to re-initiate, or at minimum a cooldown period.

#### HIGH-4: Availability overlap syncs FRIEND's calendar without their consent

**Location:** `functions/src/index.ts:3059-3062`

When User A requests overlap with Friend B, the server calls `syncUserCalendar(friendUser.firebase_uid)` — triggering a full Google Calendar API call using Friend B's stored refresh token. This happens every time A checks overlap, potentially without B being aware.

**Issues:**
- Privacy: B's calendar is being read on A's request cadence
- Rate limits: If A hammers the overlap endpoint, B's Google API quota is consumed
- Token refresh: B's tokens are silently refreshed on A's actions

**Fix:** Only sync if friend's last sync was > 15 min ago.

#### HIGH-5: `parseInt(travelBuffer, 10)` with no range validation

**Location:** `functions/src/index.ts:1128, 1188`

User can submit `travelBuffer: "99999"` — resulting in `travel_buffer_min = 99999`. This would shrink ALL free slots to zero, effectively making the user appear permanently busy with no error message.

Negative values also pass through (`parseInt("-60")` = -60), which would *expand* slots beyond actual availability.

**Fix:** Clamp to `Math.max(0, Math.min(parseInt(travelBuffer, 10) || 30, 120))`.

#### HIGH-6: `zonedToUtc` timezone helper is approximate — DST edge cases

**Location:** `functions/src/index.ts:2190-2216`

The timezone conversion uses `Intl.DateTimeFormat` to estimate offset. On DST transition days, the 8:00 AM boundary may be off by an hour in either direction.

**Impact:** Missing free slots during the "lost" hour, or double-counting during the "gained" hour.

#### HIGH-7: No friendship verification on `POST /meetups/:meetupId/counter-propose`

**Location:** `functions/src/index.ts:3673+`

The counter-propose endpoint checks that the user is a *participant* of the meetup, but doesn't verify they're still an accepted friend of the creator. If a friendship is deleted between meetup creation and counter-proposal, the user retains meetup interaction rights.

### Medium Issues (9 items)

1. **`GET /friends` exposes `socialBattery`** — Friends can see each other's battery status; reveals mental state
2. **No test coverage for calendar sync engine** — 200+ lines, zero coverage
3. **Rate limiter is in-memory** — Resets on cold start
4. **Webhook endpoint returns 503 when secret unconfigured** — Should always return 200
5. **No pagination on `GET /notifications`** — Only limit(50), older notifications inaccessible
6. **Race condition in RSVP acceptance check** — Uses stale participant data
7. **No test for OAuth token expiry mid-sync** — Missing 401 error handling
8. **Friend deletion doesn't clean up meetup_participants or groups** — Leftover data
9. **`GET /availability/overlap/:friendId` reveals exact schedule boundaries** — Can infer full schedule by subtraction

### Low Issues (5 items)

1. Notification body plaintext reveals who declined
2. `extractCity()` naive comma-split for neighborhood comparison
3. Social battery visible to friends — minor social pressure
4. Welcome notification pre-read — invisible in unread count
5. No character validation on notification title/body before FCM

### Test Coverage Analysis

**Existing Tests:** 10 scenarios, ~1,881 lines

| Scenario | Lines | Quality |
|---|---|---|
| friends | 190 | Good |
| meetups | 252 | Good |
| notification-dedup | 307 | Excellent |
| groups | 172 | Good |
| errors | 192 | Good |
| availability | 152 | Basic |
| busy-blocks | 147 | Blocked (migration pending) |
| calendar-events | 208 | Good |
| dashboard | 101 | Basic |
| notifications | 160 | Good |

**Critical Untested Paths:**
1. Calendar sync engine — most complex function, zero coverage
2. OAuth token refresh and expiry — no expired/revoked token simulation
3. Multi-friend overlap — only 1-on-1 tested
4. Webhook handler — zero test coverage
5. Account data lifecycle — no deletion tests (endpoint missing)
6. Concurrent operations — no race condition tests
7. Timezone edge cases — no DST transition tests
8. FCM push notification delivery — untested
9. Admin endpoints — zero coverage
10. Event discovery/matching — completely untested

### Recommendations (Priority Order)

| Priority | Item | Category |
|----------|------|----------|
| 🔴 Immediate | Add Outlook tokens to SENSITIVE_FIELDS | Hotfix |
| 🔴 Immediate | Remove admin secret fallback | Hotfix |
| 🟠 Sprint | Add account deletion endpoint | Feature |
| 🟠 Sprint | Remove email from friend response or opt-in | Feature |
| 🟠 Sprint | Add input length validation middleware | Hardening |
| 🟡 Next Sprint | Integration tests for calendar sync | Testing |
| 🟡 Next Sprint | Friendship re-request cooldown logic | Logic |
| ⚪ Backlog | External rate limiter (Redis/Firestore) | Infrastructure |

---

## Decision: Backend Security Fixes — Critical Audit (Zuko, 2026-04-30)

| Field | Value |
|---|---|
| **Author** | Zuko (Backend Dev) |
| **Date** | 2026-04-30 |
| **Status** | Implemented |
| **Priority** | Critical |

### Summary

Fixed 4 critical backend security vulnerabilities from full audit:

### 1. Admin Secret — Fail Closed
- Removed hardcoded fallback `"slotted-admin-2026"` from `requireAdmin`
- If `ADMIN_SECRET` env var is unset/empty, ALL admin endpoints return 403
- **Impact:** Admin endpoints unreachable unless env var explicitly configured in deployment

### 2. SENSITIVE_FIELDS — Outlook Tokens Added
- Added `outlook_access_token`, `outlook_refresh_token`, `outlook_token_expires_at`
- These are now stripped from any user object before sending to client
- **Impact:** None on existing clients — these fields were never intentionally exposed

### 3. Friends Response — Email Removed
- `email` field no longer returned in GET /friends response
- Friends see: `id`, `displayName`, `photoUrl`, `neighborhood`, `timezone`, `calendarConnected`, `eventInterests`
- **Impact:** Frontend friends list should not break (email was display-only if used at all)

### 4. Social Battery — Hidden from Friends
- Removed `socialBattery` from GET /friends and GET /dashboard friend data
- Removed `social_battery` from Supabase select query in dashboard
- Social battery remains visible only to user themselves (via /profile)
- **Impact:** Frontend dashboard/friends cards that showed friend battery will show nothing

### Verification
- `npm run build` ✅
- No schema changes required
- All changes backward-compatible

### Frontend Action Required
Katara should verify:
- Friends list doesn't expect `email` or `socialBattery` fields
- Dashboard friend cards don't render social battery for friends

---

## Decision: Frontend Security Fixes — Critical Audit (Katara, 2026-04-30)

| Field | Value |
|---|---|
| **Author** | Katara (Frontend Dev) |
| **Date** | 2026-04-30 |
| **Status** | Implemented |
| **Priority** | Critical |

### Summary

Fixed 3 critical frontend security vulnerabilities from full audit:

### 1. Removed Hardcoded Developer Email from AuthContext
- Referral fallback logic stored `sharipaltrowitz@gmail.com` in localStorage for all users without a referral param
- This was a dev-time shortcut that leaked PII
- Removed entirely — referral attribution now only works when `?ref=` param is present

### 2. Removed Credential Logging from Console
- `AuthContext.tsx`: Removed logs of Apple Calendar username and API response data
- `usePushNotifications.ts`: Removed log of raw FCM token
- **Rationale:** Any browser extension or DevTools user could harvest these credentials. Production code must never log secrets.

### 3. Firebase SW Config: Build-Time Injection
- `public/firebase-messaging-sw.js` now uses `__FIREBASE_*__` placeholder tokens instead of dummy keys
- New `firebaseSwEnvPlugin()` in `vite.config.ts` replaces these placeholders with `VITE_FIREBASE_*` environment variables at build time
- Push notifications will now work in production once the correct Firebase env vars are set in the deployment environment

### Deployment Note
Ensure `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID` are set in the build environment for push notifications to function.

### Verification
- TypeScript build ✅ (no errors)
- No breaking changes to existing APIs
- Auth flow still functional

---

## Architecture Decisions: Security Audit Follow-Up (Toph, 2026-05-01)

| Field | Value |
|---|---|
| **Author** | Toph (Lead/Architect) |
| **Date** | 2026-05-01 |
| **Status** | Ready for implementation |
| **Assignee** | Zuko (Backend) |

### Overview

Three strategic security and correctness decisions following the comprehensive audit. Implementation order: 3 → 1 → 2 (~4-5 days total).

---

## Decision 1 — RLS Policy Strategy

### Recommendation: Option A — Add defensive RLS policies now

### Rationale

The service role key is a single point of failure. If it leaks (env var exposure, logging accident, compromised Firebase Function), the attacker gets full read/write to all 18 tables with zero row-level restrictions. RLS policies cost nothing at runtime when using the service role (bypassed entirely), but they **activate immediately** if anyone connects with `anon` or `authenticated` roles — which could happen via a Supabase client misconfiguration, a future feature using client-side Supabase, or direct PostgREST access. This is pure defense-in-depth with zero performance cost.

### Implementation Spec

**File:** `database/migrations/add_rls_policies.sql`

Create policies for all 18 tables following this pattern:

```sql
-- Users: can only read/update own row
CREATE POLICY users_select_own ON users FOR SELECT
  USING (auth.uid()::text = firebase_uid);
CREATE POLICY users_update_own ON users FOR UPDATE
  USING (auth.uid()::text = firebase_uid);

-- Friendships: can see friendships you're part of
CREATE POLICY friendships_select ON friendships FOR SELECT
  USING (
    user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()::text)
    OR friend_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()::text)
  );

-- Meetups: can see meetups you participate in
CREATE POLICY meetups_select ON meetups FOR SELECT
  USING (
    id IN (SELECT meetup_id FROM meetup_participants WHERE user_id IN
      (SELECT id FROM users WHERE firebase_uid = auth.uid()::text))
  );

-- Meetup participants: can see/update your own participation
CREATE POLICY mp_select ON meetup_participants FOR SELECT
  USING (user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()::text));
CREATE POLICY mp_update ON meetup_participants FOR UPDATE
  USING (user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()::text));

-- Notifications: own only
CREATE POLICY notif_select ON notifications FOR SELECT
  USING (user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()::text));

-- Pattern: user-scoped tables (fcm_tokens, availability, suggestion_events,
--   feedback, meetup_logs, user_preferences, user_calendars, activity_dismissals,
--   manual_busy_blocks) all use: user_id = current_user_id()
```

**Key rules:**
- Every table gets at minimum a SELECT policy scoped to the owning user
- INSERT policies only where user-initiated creation makes sense (meetups, feedback)
- DELETE policies restrictive — only own data
- No UPDATE policies on `created_by` or `id` columns
- Create a helper function `current_user_internal_id()` that maps `auth.uid()` → `users.id` to DRY the subqueries

**Testing:** After deploying, verify service-role queries still work unchanged. Test with anon key to confirm policies block cross-user access.

### Risks
- Policies reference `auth.uid()` which maps to Supabase Auth, not Firebase Auth. Since we use Firebase Auth → service role, these policies only activate in a non-service-role scenario. That's fine — they're the safety net for exactly that case.
- If we ever add Supabase Auth or client-side Supabase SDK, the `firebase_uid` mapping needs rethinking.

### Effort
1-2 days

---

## Decision 2 — Token Encryption Strategy

### Recommendation: Option D (hybrid) — Move tokens to `oauth_tokens` table + Supabase Vault (pgsodium)

### Rationale

Supabase Vault is the simplest option that actually works in this stack. It's built into Supabase, requires no external KMS, no key management in Firebase Functions, and encrypts at the column level using `pgsodium`. Moving tokens to a separate table isolates the sensitive surface area (smaller blast radius for a targeted table dump) and makes it easy to apply different access policies. App-layer encryption (Option B) would require managing encryption keys in Firebase Functions environment — feasible but adds operational complexity for key rotation. Vault handles rotation natively.

### Implementation Spec

**Phase 1 — New table + migration:**

**File:** `database/migrations/create_oauth_tokens.sql`

```sql
-- Depends on: vault extension enabled in Supabase dashboard
CREATE TABLE oauth_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL CHECK (provider IN ('google', 'outlook', 'apple')),
  
  -- Encrypted via Supabase Vault (pgsodium transparent column encryption)
  access_token    TEXT,
  refresh_token   TEXT,
  token_expires_at TIMESTAMPTZ,
  
  -- Apple CalDAV specific
  caldav_username TEXT,
  caldav_password TEXT,
  
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE (user_id, provider)
);

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Encrypt sensitive columns using vault
SELECT vault.create_secret('oauth_tokens_access_token_key', 'pgsodium');
SECURITY LABEL FOR pgsodium ON COLUMN oauth_tokens.access_token IS 'ENCRYPT WITH KEY ID oauth_tokens_access_token_key';
SECURITY LABEL FOR pgsodium ON COLUMN oauth_tokens.refresh_token IS 'ENCRYPT WITH KEY ID oauth_tokens_access_token_key';
SECURITY LABEL FOR pgsodium ON COLUMN oauth_tokens.caldav_password IS 'ENCRYPT WITH KEY ID oauth_tokens_access_token_key';
```

**Phase 2 — Data migration:**

**File:** `database/migrations/migrate_tokens_to_vault.sql`

```sql
-- Copy existing tokens to new table
INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, token_expires_at)
SELECT id, 'google', google_access_token, google_refresh_token, google_token_expires_at
FROM users WHERE google_access_token IS NOT NULL;

INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, token_expires_at)
SELECT id, 'outlook', outlook_access_token, outlook_refresh_token, outlook_token_expires_at
FROM users WHERE outlook_access_token IS NOT NULL;

INSERT INTO oauth_tokens (user_id, provider, caldav_username, caldav_password)
SELECT id, 'apple', apple_caldav_username, apple_caldav_password
FROM users WHERE apple_caldav_username IS NOT NULL;

-- Drop old columns (run AFTER verifying migration)
-- ALTER TABLE users DROP COLUMN google_access_token, ...
```

**Phase 3 — Backend changes:**

**File:** `functions/src/index.ts` — everywhere that reads/writes OAuth tokens:
- Replace `users.google_access_token` reads with `SELECT access_token FROM oauth_tokens WHERE user_id = $1 AND provider = 'google'`
- Replace token writes (OAuth callback, token refresh) to INSERT/UPDATE `oauth_tokens`
- Search for: `google_access_token`, `google_refresh_token`, `outlook_access_token`, `outlook_refresh_token`, `apple_caldav_password`

### Risks
- Supabase Vault (pgsodium) must be enabled in the Supabase dashboard first. Check project settings → Extensions.
- Vault's transparent encryption means the service role still sees plaintext in query results — protection is against raw disk/backup exposure, not a compromised service role. For service-role compromise, RLS policies (Decision 1) are the complementary control.
- Token reads add one JOIN. Negligible perf impact.

### Effort
2-3 days

---

## Decision 3 — Meetup Race Condition

### Recommendation: Option A — Database trigger

### Rationale

A Postgres trigger is the most robust solution because it executes atomically within the same transaction as the RSVP update — there's no window where two concurrent updates can both see stale state. It's also the simplest to maintain: the logic lives in one place (the database), requires no application-code coordination, and works regardless of which code path updates the participant row. Serializable isolation (Option B) adds retry complexity and potential deadlocks. Optimistic locking (Option C) pushes race handling to application code across potentially multiple endpoints.

### Implementation Spec

**File:** `database/migrations/add_meetup_auto_confirm_trigger.sql`

```sql
CREATE OR REPLACE FUNCTION check_meetup_all_accepted()
RETURNS TRIGGER AS $$
DECLARE
  total_count INT;
  accepted_count INT;
  meetup_status TEXT;
BEGIN
  -- Only fire when rsvp changes to 'accepted'
  IF NEW.rsvp != 'accepted' OR (OLD.rsvp = 'accepted') THEN
    RETURN NEW;
  END IF;

  -- Get current meetup status (skip if already confirmed/cancelled)
  SELECT status INTO meetup_status FROM meetups WHERE id = NEW.meetup_id FOR UPDATE;
  IF meetup_status != 'proposed' THEN
    RETURN NEW;
  END IF;

  -- Count participants
  SELECT COUNT(*) INTO total_count
  FROM meetup_participants WHERE meetup_id = NEW.meetup_id;

  SELECT COUNT(*) INTO accepted_count
  FROM meetup_participants WHERE meetup_id = NEW.meetup_id AND rsvp = 'accepted';

  -- +1 because NEW row hasn't been committed yet in BEFORE trigger
  -- (Use AFTER trigger instead to avoid this)
  IF accepted_count = total_count THEN
    UPDATE meetups SET status = 'confirmed' WHERE id = NEW.meetup_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_meetup_check_all_accepted
  AFTER UPDATE OF rsvp ON meetup_participants
  FOR EACH ROW
  EXECUTE FUNCTION check_meetup_all_accepted();
```

**Key details:**
- Uses AFTER UPDATE trigger so `NEW` row is already visible in the count
- `FOR UPDATE` lock on the meetups row serializes concurrent checks — two triggers firing simultaneously will serialize on this lock, ensuring exactly one sees the final count
- Only fires on `rsvp` column changes (efficient)
- Guards against double-firing: skips if meetup already confirmed
- The existing application code that checks "all accepted" in `index.ts` should be **kept as a fallback** log/no-op (belt and suspenders), but the trigger is now the authoritative state transition

**Backend change (minimal):**

**File:** `functions/src/index.ts` — find the RSVP acceptance handler:
- Remove the "check all accepted and update meetup status" logic OR convert it to a read-only assertion/log
- The trigger handles it atomically now
- Keep the notification-sending logic in the application code (trigger shouldn't send HTTP requests)

**Notification flow:**
After the RSVP update returns, re-read the meetup status. If it's now `confirmed`, fire the "meetup confirmed" notifications. This is safe because the trigger already ran within the same transaction.

### Risks
- Trigger runs inside the transaction — if it errors, the RSVP update rolls back. Keep the trigger logic simple and defensive.
- Notification sending must remain in application code (Firebase Functions), not in the trigger. The trigger only transitions state.
- If we add new RSVP states (e.g., 'tentative'), the trigger condition needs updating.

### Effort
0.5 day

---

## Implementation Summary

| # | Decision | Effort | Priority |
|---|----------|--------|----------|
| 1 | Defensive RLS policies | 1-2 days | High (defense-in-depth) |
| 2 | OAuth tokens → Vault-encrypted table | 2-3 days | Critical (data protection) |
| 3 | Database trigger for auto-confirm | 0.5 day | Medium (correctness) |

**Implementation order:** 3 → 1 → 2 (quick win first, then defense-in-depth, then the larger migration)

Zuko: start with Decision 3 (trigger), it's a single migration file. Then tackle 1 and 2 in sequence.

---

## Decision: Frontend npm Audit Fix — serialize-javascript Override (Katara, 2026-05-01)

| Field | Value |
|---|---|
| **Author** | Katara (Frontend Dev) |
| **Date** | 2026-05-01 |
| **Status** | Implemented |
| **Priority** | High |

### Context

The `vite-plugin-pwa@1.2.0` → `workbox-build@7.4.0` → `@rollup/plugin-terser@0.4.4` → `serialize-javascript@6.0.2` chain has 4 high-severity vulnerabilities. No upstream fix is available yet (vite-plugin-pwa 1.2.0 is the latest).

### Decision

Added `"overrides": { "serialize-javascript": ">=7.0.5" }` to client/package.json to force the patched version.

### Trade-offs
- **Pro:** Eliminates all npm audit vulnerabilities immediately (16 → 0).
- **Con:** Override may need removal once upstream updates (monitor vite-plugin-pwa releases).
- **Risk:** Low — serialize-javascript 7.x is backward-compatible for this use case (build-time serialization in workbox).

### Action Items
- [ ] Remove override when vite-plugin-pwa ships with fixed transitive deps (monitor releases)

### Result
- ✅ npm audit: 16 vulnerabilities → 0
- ✅ Build passes
- ✅ No breaking changes

---

---

## Audit Finding: Functional Flow Testing — Core User Journeys (Sokka, 2026-05-01)

| Field | Value |
|---|---|
| **Author** | Sokka (Tester) |
| **Date** | 2026-05-01 |
| **Status** | Audit Complete — Issues Prioritized |
| **Scope** | 6 core flows: signup, friends, meetups, calendar sync, notifications, groups |

### Summary

Deep end-to-end functional testing of all 6 core user flows with line-by-line code inspection through frontend (React 19, AuthContext, pages, components) → backend (index.ts 9797 lines) → database (schema.sql).

**Issue Breakdown:**
- **1 Critical** (blocks core functionality)
- **6 High** (incorrect behavior)
- **11 Medium** (degrades experience)
- **5 Low** (minor/cosmetic)

### Critical Issue: Groups Feature Broken in Production

**Frontend `GroupAvailability.tsx:52` calls `POST /availability/group-overlap` — this endpoint DOES NOT EXIST.**
- Backend only has `POST /availability/multi-friend-overlap`
- Users selecting multiple friends to find common time get immediate 404 error
- Complete group CRUD missing: schema exists (friend_groups, friend_group_members tables), but zero API endpoints for create/list/update/delete

### High-Priority Issues

| # | Flow | Issue | Impact |
|---|------|-------|--------|
| 1 | Friends | Simultaneous cross-friend-requests create permanent pending state | User A sends to B, B simultaneously sends to A → upsert overwrites invited_by → one user can't accept, other's request vanishes |
| 2 | Meetups | No validation that proposed time is in the future | Past meetups accepted and pollute the list; never trigger reminders |
| 3 | Meetups | No validation that endTime > startTime | Backward meetups created silently (end before start) |
| 4 | Calendar | `zonedToUtc` DST edge-case off-by-hour bug | Intl.DateTimeFormat reference date bug during transitions (e.g., 2am spring forward) produces off-by-hour error |
| 5 | Groups | No CRUD endpoints for `friend_groups` table | Schema exists, zero API implementation — production blocker |
| 6 | Meetups | Counter-propose doesn't auto-cancel original 1:1 meetup | Proposer's RSVP set to "declined" on original, but unlike normal decline, trigger logic missing → original stays "proposed" with one declined participant |

### Medium-Priority Issues

| # | Flow | Issue | Workaround |
|---|------|-------|-----------|
| 7 | Signup | `syncUserToDb` uses raw `fetch` instead of `api` wrapper | Bypasses error interceptors; silent failure → user stuck in 404 loop | Use api wrapper; proper error recovery |
| 8 | Signup | Onboarding race: completeOnboarding called even if mutation fails | Fix: only call in mutation's `onSuccess` |
| 9 | Friends | Accept on already-accepted friendship re-triggers `friend_accepted` notification | Add check: `data.status === 'pending'` before sending accept notification |
| 10 | Friends | Upsert on re-request resets other user's friendship_type | Payload includes `user_a_friendship_type: defaultFriendshipType` — overwrites OTHER user's setting |
| 11 | Meetups | Group decline leaves meetup in limbo forever | 3+ person meetup, one declines → stays "proposed" with no status recalculation or "still want to meet?" logic |
| 12 | Meetups | Notification times formatted in server locale, not recipient TZ | `toLocaleDateString/toLocaleTimeString` uses Firebase Functions server locale |
| 13 | Calendar | Calendar sync deletes ALL availability before re-inserting | DELETE all → INSERT: brief window with zero availability data; insert failure leaves user with zero data until next sync |
| 14 | Calendar | Webhook double-syncs | Full `syncUserCalendar()` called first, then IMMEDIATELY `calendarApi.events.list` with syncToken — redundant work |
| 15 | Notifications | `meetup_request` type is overloaded | Used for: initial invite, "X can't make it", "X suggested different time", "maybe" RSVP → 1hr relatedUserId dedup suppresses legitimate different notifications |
| 16 | Notifications | No push suppression when app is open | App-open user gets both in-app + FCM push notification simultaneously |
| 17 | Calendar | Apple CalDAV credentials stored as plaintext | No encryption/decryption visible; schema comment says "encrypted" but code stores raw password |

### Low-Priority Issues

| # | Flow | Issue |
|---|------|-------|
| 18 | Signup | No `socialFrequency` or `travelBuffer` validation | Schema has no CHECK constraints; `parseInt(travelBuffer)` allows 99999 or negative values |
| 19 | Friends | `connect-referral` can overwrite friendship metadata | Upsert is safe (won't duplicate) but can downgrade accepted friendship back to "accepted" with different `invited_by`, or change `friendship_type` |
| 20 | Notifications | No old notification cleanup/TTL | `GET /notifications` capped at 50 results, but old unread notifications accumulate indefinitely — no TTL or scheduled cleanup |
| 21 | Meetups | No "edit meetup" capability after creation | Once created, time/location/title cannot be modified (only counter-proposed or cancelled) |
| 22 | Friends | Friend deletion doesn't clean up fully | Orphaned `friend_group_members` rows (deleted friend still in groups), active/pending meetups persist as "proposed" forever, old `suggestion_events` remain |

### Architectural Insights

1. **Notification type overload:** `meetup_request` used for 4+ semantic events (initial invite, decline, counter-propose, maybe RSVP) causes false dedup suppression
2. **Calendar sync destructive:** DELETE all → INSERT new creates brief zero-availability window; if insert fails, user has zero data until next sync
3. **Group schema orphaned:** `friend_groups` + `friend_group_members` tables exist in schema but have zero API layer (complete CRUD missing — this is a production blocker)
4. **Time validation missing:** No temporal checks on meetup creation (past times accepted, backward times accepted)
5. **Timezone fragility:** Calendar sync notification text uses Firebase Functions server locale, not per-recipient timezone

### Recommendations (Priority Order)

**Hotfixes (this sprint):**
1. Wire missing `POST /availability/group-overlap` endpoint (call existing `multi-friend-overlap`)
2. Add future-time and endTime > startTime validation to meetup creation

**Sprint 1:**
- Implement full group CRUD (POST /groups, GET /groups, PATCH /groups/:id, DELETE /groups/:id, member management)
- Fix simultaneous cross-request race (prevent upsert from overwriting invited_by)
- Add counter-propose auto-cancel for 1:1 meetups
- Fix `zonedToUtc` DST edge case

**Sprint 2:**
- Fix `syncUserToDb` error handling (use api wrapper, proper error recovery)
- Implement notification type differentiation (separate types for counter-propose vs initial invite)
- Add per-recipient timezone localization for notification text
- Eliminate calendar sync delete-before-insert window (use upsert or transaction)
- Add push suppression when app is in foreground

**Backlog:**
- Implement notification preferences/muting
- Add old notification cleanup/TTL job
- Implement "edit meetup" capability
- Add input length validation middleware

### Full Report

See `.squad/decisions/inbox/sokka-functional-testing.md` for complete details:
- Per-flow breakdown: Works Correctly ✅, Bugs Found 🐛, Missing Functionality 🚫, Edge Cases ⚠️
- Line-by-line code references (AuthContext.tsx, index.ts, schema.sql, component files)
- Test coverage gaps and privacy considerations
- Edge cases and social dynamics review

---
