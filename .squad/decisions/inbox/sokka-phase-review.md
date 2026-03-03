# Code Review: Two-Way Calendar Sync (Phases 1-3)

**Author:** Sokka (QA)
**Date:** 2026-03-03
**Status:** Conditional Approve — 3 critical issues must be fixed
**Scope:** `functions/src/index.ts` (lines 6440-8000), `client/src/pages/NotificationsPage.tsx`

---

## Verdict: ⚠️ CONDITIONAL APPROVE

The implementation is structurally sound and covers the core happy paths well. However, 3 critical bugs and 2 high-severity gaps must be addressed before this ships to production users.

---

## Scenario Coverage Scorecard

### Happy Path (6 scenarios)

| ID | Scenario | Rating | Notes |
|----|----------|--------|-------|
| HP-01 | GCal decline → Slotted RSVP update | ✅ COVERED | `processCalendarChanges` line 7626-7628 correctly maps RSVP. Notification uses soft language ("is no longer available", line 7736). |
| HP-02 | GCal "maybe" → Slotted "maybe" | ✅ COVERED | `mapGoogleRsvp("tentative")` → `"maybe"` (line 7697). Notification: "is now a maybe" (line 7749). |
| HP-03 | GCal time change → counter-propose | ⚠️ PARTIAL | Time change detection works (lines 7632-7681). **BUT:** Creator changes silently overwrite meetup time for ALL participants (line 7646-7649) without consent from others. This violates "Slotted = source of truth for multi-party state." Only non-creator changes trigger counter-propose. |
| HP-04 | GCal event deleted → treat as decline | ✅ COVERED | `event.status === "cancelled"` check at line 7615, maps to declined. Correctly skips if already declined. |
| HP-05 | Friend accepts in Slotted → GCal event created | ✅ COVERED | Existing one-way flow. `rsvp_source: "app"` set at line 3511 on PATCH /meetups/:id/rsvp. |
| HP-06 | GCal "accepted" → Slotted accepted | ✅ COVERED | `mapGoogleRsvp("accepted")` → `"accepted"` (line 7692). Notification sent to creator (line 7754-7762). |

### Conflict Scenarios (5 scenarios)

| ID | Scenario | Rating | Notes |
|----|----------|--------|-------|
| CF-01 | Simultaneous Slotted + GCal modification | ❌ MISSING | **CRITICAL.** `rsvp_source` is selected (line 7598) but NEVER checked. If user declines in Slotted (sets `rsvp_source: "app"`), a subsequent webhook can overwrite it back because the code only checks `mappedRsvp !== participant.rsvp` (line 7627), not whether the existing RSVP was app-sourced. Need: `if (participant.rsvp_source === "app" && <recent>) skip`. |
| CF-02 | GCal deleted during counter-propose | ⚠️ PARTIAL | Deletion → decline works. Counter-propose is notification-only (no DB state for "in-flight counter-propose"), so no crash risk. But the user experience is confusing — no explicit handling. |
| CF-03 | Timezone change detection | ✅ COVERED | Comparison uses `new Date(eventStart).toISOString()` vs `new Date(meetup.start_time).toISOString()` (lines 7638-7641). Both resolve to UTC, so absolute timestamps are compared correctly. |
| CF-04 | All-day event conversion | ⚠️ PARTIAL | Code reads `event.start.date` (date-only) as fallback (line 7634). An all-day "2025-03-15" becomes midnight UTC — a large time drift. Will trigger time change flow but with weird notification ("moved it to 12:00:00 AM"). No special handling for all-day. |
| CF-05 | Webhook for cancelled meetup | ✅ COVERED | Line 7613: `if (!meetup \|\| ["cancelled", "completed"].includes(meetup.status)) continue;` — correctly skips. |

### Edge Cases (10 scenarios)

| ID | Scenario | Rating | Notes |
|----|----------|--------|-------|
| EC-01 | OAuth token expired during webhook | ✅ COVERED | `getAuthedCalendarClient` (line 6338-6368) sets up auto-refresh via `oauth2.on("tokens")`. Persists new tokens to DB. If refresh_token is revoked, `getAuthedCalendarClient` returns null (line 6340), webhook skips gracefully. **Gap:** No "please reconnect" notification sent on revoked token. |
| EC-02 | Webhook delivery retry / idempotency | ✅ COVERED | `gcal_etag` check (line 7605) prevents reprocessing. Sync token ensures incremental. |
| EC-03 | Watch channel renewal | ✅ COVERED | `renewCalendarWatchChannels` (line 7953-8000) runs every 6 hours, stops old channel, creates new one. **Gap:** No catch-up sync after renewal — if events changed during the gap between channel expiry and renewal, they could be missed. |
| EC-04 | User disconnects Google Calendar | ❌ MISSING | **CRITICAL.** `POST /calendar/disconnect` (line 6516-6558) clears OAuth tokens and removes `user_calendars`, but does NOT clear: `calendar_watch_channel`, `calendar_watch_resource_id`, `calendar_sync_token`. Also does NOT null out `google_event_id` on `meetup_participants` rows. Stale watch channels will keep firing webhooks that get looked up but find no user match (wastes DB queries). |
| EC-05 | Recurring event modifications | 🔮 FUTURE | Not implemented. V2+ per backlog. No recurring meetup support exists. |
| EC-06 | Multi-calendar event move | 🔮 FUTURE | Per decision doc: watch primary only. Cross-calendar moves will look like deletions. Accepted risk. |
| EC-07 | Non-Slotted event webhook (hot path) | ✅ COVERED | `if (!participant) continue;` at line 7603 exits fast for non-matching events. Sync token still updated. |
| EC-08 | Unknown channel ID webhook | ❌ MISSING | **CRITICAL.** Webhook returns `403` for failed token validation (line 7778). Per Google's docs, returning 4xx causes Google to deactivate the endpoint after repeated failures. Must return `200` for ALL requests (even unauthenticated ones) to keep the endpoint alive. The token check at line 7777 should log the mismatch and return 200, not 403. |
| EC-09 | Google API quota exceeded (429) | ⚠️ PARTIAL | No explicit 429 handling. The outer catch (line 7832) logs the error. Sync token is preserved (change happened before the API call). But no retry/backoff — the sync is just dropped. Will self-heal on next webhook. |
| EC-10 | Stale sync token (410 Gone) | ⚠️ PARTIAL | Token is cleared on 410 (line 7819-7825). **BUT** no retry happens — the function exits without re-fetching. The NEXT webhook will do a full sync (no token = full event list). This means there's a one-webhook delay in catching up. Acceptable but not ideal. |

### Privacy Invariants (5 scenarios)

| ID | Scenario | Rating | Notes |
|----|----------|--------|-------|
| PV-01 | No exposure of other calendar events | ✅ COVERED | `processCalendarChanges` only reads: `event.id`, `event.status`, `event.attendees`, `event.start`, `event.end`, `event.etag` (lines 7594-7684). No title, description, or location of non-Slotted events is stored. |
| PV-02 | No PII in webhook logs | ⚠️ PARTIAL | `console.log("Calendar webhook:", { channelId, resourceState })` (line 7784) is safe. But `console.error("Incremental sync error:", syncErr)` (line 7827) and `console.error("Webhook sync error:", err)` (line 7833) could include PII in error stack traces (user emails in API error responses). Should use structured logging with field allowlists. |
| PV-03 | Queries scoped to webhook user | ✅ COVERED | All queries in `processCalendarChanges` include `.eq("user_id", dbUser.id)` (line 7600). Webhook handler scopes by `calendar_watch_channel` → `firebase_uid`. No cross-user queries. |
| PV-04 | Webhook origin verification | ⚠️ PARTIAL | Uses `GOOGLE_WEBHOOK_SECRET` as shared token (line 7777). This is defense-in-depth, not cryptographic verification. Acceptable for now — Google signs the token into the channel at creation time. BUT: returning 403 (not 200) for failures is wrong (see EC-08). |
| PV-05 | No calendar details in notifications | ✅ COVERED | Notifications reference only meetup title and participant display_name. No calendar event details, conflict reasons, or other-event info. |

### Performance (4 scenarios)

| ID | Scenario | Rating | Notes |
|----|----------|--------|-------|
| PF-01 | Bulk sync after reconnection | ⚠️ PARTIAL | No special reconnection logic. Calendar connect triggers watch channel setup but no bulk reconciliation of missed changes. No notification batching. |
| PF-02 | Webhook storm (20 rapid webhooks) | ❌ MISSING | No debouncing. Each webhook fires `syncUserCalendar()` (line 7796) AND `events.list` (line 7802) independently. 20 webhooks = 20 full sync cycles and 20 incremental syncs. No mutex, no queue, no dedup. |
| PF-03 | Non-Slotted event hot path | ✅ COVERED | Fast exit at line 7603. Sync token updated at line 7810-7816. Non-Slotted events are touched minimally. |
| PF-04 | Bulk channel renewal | ⚠️ PARTIAL | `renewCalendarWatchChannels` iterates sequentially (line 7962 for-loop), which is fine for batching. But no explicit batching with delays — processes all users in one go. No 429 backoff. At 500 users, this could hit Google rate limits. |

---

## Critical Issues (Must Fix Before Ship)

### 🔴 CRIT-1: Feedback Loop Prevention is Broken
**File:** `functions/src/index.ts:7598, 7626-7628`
**Problem:** `rsvp_source` is selected but never checked. A user declining in Slotted (setting `rsvp_source: "app"`) can have their RSVP overwritten by a subsequent webhook that reads the old Google Calendar state.
**Fix:** After line 7605, add: `if (participant.rsvp_source === "app" && participant.gcal_etag !== event.etag) { /* only update etag, skip RSVP change */ }`. Or use a timestamp-based recency check.

### 🔴 CRIT-2: Disconnect Doesn't Clean Up Watch State
**File:** `functions/src/index.ts:6536-6543`
**Problem:** `POST /calendar/disconnect` clears OAuth tokens but leaves `calendar_watch_channel`, `calendar_watch_resource_id`, `calendar_sync_token` intact. Also doesn't null `google_event_id` on `meetup_participants`.
**Fix:** Add these fields to the update payload at line 6538-6541. Add a separate query to null `google_event_id` on user's participant rows.

### 🔴 CRIT-3: Webhook Returns 403 for Unknown Tokens
**File:** `functions/src/index.ts:7777-7779`
**Problem:** Google will deactivate webhook endpoints that return 4xx errors. Unknown/invalid tokens should return 200 with no processing.
**Fix:** Change line 7778-7779 from `res.status(403).json(...)` to `console.warn("Invalid webhook token")` and fall through to the `res.status(200).send("OK")` at line 7837.

---

## High-Severity Issues

### 🟡 HIGH-1: Creator Time Change Silently Overrides Group
**File:** `functions/src/index.ts:7644-7667`
**Problem:** When the meetup creator moves the event in GCal, the meetup time is silently updated for ALL participants. This violates the principle that Slotted is source of truth for multi-party state. The creator should get the same counter-propose flow, or at minimum a confirmation step.

### 🟡 HIGH-2: 410 Stale Token Doesn't Retry
**File:** `functions/src/index.ts:7818-7828`
**Problem:** On 410, token is cleared but no full sync is attempted. Changes are delayed until next webhook.
**Fix:** After clearing the token, re-call `events.list` without `syncToken` to do a full sync.

---

## Notification Language Audit

| Scenario | Expected Language | Actual Language | Compliant? |
|----------|------------------|-----------------|------------|
| Decline via GCal | "can't make it" / "updated RSVP" | "is no longer available" (line 7736) | ✅ |
| Delete GCal event | "won't be joining" | "is no longer available" (same path) | ✅ |
| Maybe via GCal | "might not make it" | "is now a maybe" (line 7749) | ✅ |
| Time change (creator) | "updated the time" | "🕐 [Name] updated the time" (line 7662) | ✅ |
| Counter-propose | "suggested a different time" | "💡 [Name] suggests a different time" (line 7673) | ✅ |
| Frontend decline button | "Not this time" | "Not this time" (line 461) | ✅ |
| Frontend counter-propose done | "Suggested new time" | "🔄 Suggested new time" (line 431) | ✅ |

**Overall: All notification language is compliant with soft social dynamics.** No "declined", "rejected", or "cancelled" in user-facing strings.

---

## Summary

| Category | ✅ Covered | ⚠️ Partial | ❌ Missing | 🔮 Future |
|----------|-----------|-----------|-----------|----------|
| Happy Path (6) | 5 | 1 | 0 | 0 |
| Conflicts (5) | 2 | 2 | 1 | 0 |
| Edge Cases (10) | 4 | 2 | 2 | 2 |
| Privacy (5) | 3 | 2 | 0 | 0 |
| Performance (4) | 1 | 2 | 1 | 0 |
| **Total (30)** | **15** | **9** | **4** | **2** |

**Coverage: 50% fully covered, 30% partial, 13% missing, 7% deferred.** The 3 critical bugs (CRIT-1 through CRIT-3) are all in the "missing" category and block ship readiness.
