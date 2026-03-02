# Decisions

> Canonical record of team decisions. Append-only. Scribe merges from inbox.

---

## Architecture Decision: Two-Way Calendar Sync (Leo, 2026-02-28)

| Field | Value |
|---|---|
| **Author** | Leo (Lead) |
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

## Edge Cases Affecting Two-Way Sync Architecture (Josh, 2026-02-27)

**From:** Josh (QA)  
**To:** Leo (Architect), Shari  
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

**Need from Leo:** Define thresholds and the flow. My tests will assert against whatever is decided.

#### 4. Stale Sync Token Recovery (EC-10)

**Problem:** If `calendar_sync_token` goes stale (Google returns 410), we need a full re-sync. During a full sync, we might find Google events that don't correspond to any Slotted meetup (user's personal events). We MUST NOT create meetups from these — only match against existing `google_event_id` values.

**Risk:** If the full sync code uses the same "process new events" path as the incremental sync, it might try to create meetup records from non-Slotted events. The sync handler needs separate paths for "known Slotted events" vs. "unknown events."

### Non-Critical But Notable

- **EC-08 (unknown channel ID):** Must return 200, not 4xx. Google will deactivate our endpoint if it gets too many errors. This is a correctness requirement, not just a nice-to-have.
- **PF-04 (bulk channel renewal):** Google's `events.watch` has a per-user rate limit. Renewing 500 channels needs batching with delays. Budget ~15 min for the scheduled function.
- **AP-03 (Apple auth failure):** Don't retry with bad credentials — Apple/iCloud may lock the account after repeated failures.

---

## Decision: Empty State Strategy (CJ, 2025-01-27)

**Author:** CJ (Frontend Dev)  
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

## Improvement Analysis (Leo, 2026-02-27)

**Summary:** Leo's full-stack codebase analysis identified 18 prioritized improvements:
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
