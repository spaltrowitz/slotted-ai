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
