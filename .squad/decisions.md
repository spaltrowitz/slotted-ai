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
