# Toph — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** React 19 + TS + Tailwind v4 + Vite (client/), Firebase Functions + Express (functions/), Supabase PostgreSQL (database/), Firebase Auth
- **Key docs:** docs/06-mvp-current-state.md, docs/03-prd-mvp-v1.md, docs/11-beta-tester-feedback.md

## Learnings

### Architecture (Feb 2026)
- **Backend monolith:** `functions/src/index.ts` is 8,371 lines with 87+ endpoints and 3 scheduled functions. Single biggest velocity bottleneck. Must split before scaling the team.
- **Frontend large files:** `DashboardPage.tsx` (1,709 lines), `SettingsPage.tsx` (1,242 lines), `FriendsPage.tsx` (1,007 lines) — candidates for component extraction.
- **API layer:** Client uses centralized `client/src/lib/api.ts` with Axios + Firebase token interceptor. All endpoints go through this.
- **Database:** 18 tables with RLS enabled. Service role key bypasses RLS (backend only). Schema canonical source: `database/schema.sql`.
- **Build:** Frontend: `cd client && npm run build` (tsc + vite). Backend: `cd functions && npm run build` (esbuild). Deploy: `firebase deploy`.

### Key Decisions
- Social Battery is never visible to friends — private input to AI only.
- "Not this time" replaces "Decline" — soft social language throughout.
- Group scheduling was pulled into V1 despite original V2 plan.
- OAuth tokens stored in plaintext — flagged as priority security fix.
- CORS allows all origins in production (line 55 of index.ts) — needs tightening.
- InvitePage.tsx exists but has no route in App.tsx — invite links 404 for new users.

### User Preferences (from beta feedback)
- Tamer: wants auto-calendar add (done), two-way sync (pending), no duplicate notifications (fixed).
- Darren: wants inclusive language "friends & family" (done), social goal tracking (done).
- Emma: doesn't maintain calendar — needs the app to work without perfect calendar hygiene. Group coordination is her entry point.
- Tom: parent use case — couple mode / family scheduling validates V2 backlog item 7b.

### Key File Paths
- Canonical schema: `database/schema.sql`
- All API endpoints: `functions/src/index.ts`
- Frontend routing: `client/src/App.tsx`
- Auth context: `client/src/contexts/AuthContext.tsx`
- API client: `client/src/lib/api.ts`
- UX audit: `docs/10-ux-audit-checklist.md`
- Beta feedback: `docs/11-beta-tester-feedback.md`
- Current state (ground truth): `docs/06-mvp-current-state.md`
- Google OAuth verification plan: `docs/plans/plan-google-oauth-verification.md`
- Test infrastructure: `tests/agents/` (scenario-based, not wired to CI)
- Two-way sync plan: `docs/plans/plan-two-way-calendar-sync.md`

### Two-Way Calendar Sync Architecture (Feb 2026)
- **Watch channels are scaffolded but never created.** The webhook endpoint (`POST /webhooks/google-calendar`) exists, `GOOGLE_WEBHOOK_SECRET` is set, `calendar_watch_channel`/`calendar_watch_expiry` columns exist on `users` — but `calendar.events.watch()` is never called. The circuit is 80% wired.
- **`syncUserCalendar()` does full fetches every time** — no sync tokens. It writes to the `availability` table (free/busy blocks) but never inspects individual events for RSVP or time changes.
- **`google_event_id` on `meetup_participants`** is the key link between Slotted meetups and Google Calendar events. Already shipped via `migrations/add_google_event_id.sql`.
- **`autoAddToCalendar()` creates GCal events** on meetup confirmation. Already has write scope (`calendar.events`).
- **Feedback loop prevention is critical.** When RSVP changes flow in from Google Calendar, the system must track `rsvp_source` to avoid pushing the change back to GCal and triggering an infinite loop.
- **Conflict resolution rule:** Calendar = source of truth for individual RSVP. Slotted = source of truth for multi-party state (who's invited, overall meetup status, time for everyone).
- **Per-user watch on 'primary' calendar** is sufficient for Phase 1 since Slotted only writes events to primary. Per-calendar watches can be added later.
- **Notification language for calendar-originated changes** must follow Slotted's soft social dynamics: "is no longer available" not "declined."

### Groups Feature Scope (Feb 2026)
- **Groups feature is fully implemented in V1** with 2 database tables (`friend_groups`, `friend_group_members`), 5 backend endpoints (`GET /groups`, `POST /groups`, `PUT /groups/:id`, `POST /groups/:id/members`, `DELETE /groups/:id`), and extensive FriendsPage UI for creating/editing/deleting saved groups.
- **Critical finding:** The `GroupAvailability` component is NOT group-specific — it accepts any `friendIds[]` array and finds joint availability. Multi-friend scheduling works independently of saved groups.
- **Removal scope:** 2 database tables, 5 endpoints, ~400 lines of FriendsPage.tsx state/handlers/UI, 4 notification types (all using `type: "friend_accepted"`), `group_id` column on `pending_invites`, `SavedGroup` interface and `fetchGroups()` query in queries.ts.
- **What stays:** Multi-friend scheduling flow (select 2+ friends → find times → book). Just needs rebranding: rename `GroupAvailability` → `MultiFriendAvailability`, rename endpoint `/availability/group-overlap` → `/availability/multi-friend`, remove all "group" language from UI.
- **Key risk:** `pending_invites` migration must reverse cleanly. Drop `group_id` column, restore `UNIQUE (inviter_id, invited_email)` constraint. Any pending group invites become orphaned.
- **User impact:** All saved groups will be deleted. Users can still schedule with multiple friends, just can't save those collections for reuse.

### 2026-03-05 — Mai Joins Team; Product Architecture Review Complete

**New hire:** Mai (Product Strategist) joined as critical reviewer of product strategy, feature prioritization, and MVP scoping.

**Mai's key findings** (from `docs/plans/research-product-strategy-review.md`):
- Current Dashboard is "Week 4 feature designed for Day 1" — all features visible to new users
- Solution: State-aware progressive disclosure architecture (unlock features by milestone: 0→1→3+ friends, hangout count, time on platform)
- Proposed Day 1: OAuth → Calendar → Invite → Friend joins → Single suggestion → Book (< 3 min)
- Removes: Events page (from V1), Social Battery (gate behind milestones), Activity Feed (gate), Hangout Logging (gate), advanced settings (gate)
- First scheduling uses "How about Saturday 2pm?" (single suggestion), not ranked lists
- Onboarding simplified to calendar connect only; preferred times learned from behavior
- Dashboard header dual CTAs (Log + Invite) collapsed to single contextual action

**Implication for architecture:**
- Dashboard routing and visibility logic becomes state-dependent (not just authenticated/unauthenticated)
- May require Milestone enum/status column on `users` table or computed milestone in API response
- Potential refactor: DashboardPage component tree must switch sections dynamically based on milestone

**Alignment with Suki's audit:**
- Both recommend removing Events page
- Emoji reduction supports progressive disclosure (less visual chaos for new users)
- Groups removal aligns with simplified Day 1 (focus on 1:1 and immediate multi-friend need)
