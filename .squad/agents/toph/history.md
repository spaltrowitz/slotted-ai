# Toph — History

## Key Patterns & Corrections

### Architecture
- **Backend monolith:** `functions/src/index.ts` is 8,371 lines / 87+ endpoints / 3 scheduled functions. Biggest velocity bottleneck.
- **Frontend large files:** DashboardPage (1,709), SettingsPage (1,242), FriendsPage (1,007) — candidates for extraction.
- **API layer:** Centralized `client/src/lib/api.ts` with Axios + Firebase token interceptor.
- **Database:** 18 tables with RLS enabled. Service role bypasses. Schema: `database/schema.sql`.
- **Key file paths:** Schema (`database/schema.sql`), endpoints (`functions/src/index.ts`), routing (`client/src/App.tsx`), auth (`client/src/contexts/AuthContext.tsx`), API client (`client/src/lib/api.ts`), tests (`tests/agents/`).

### Key Decisions
- Social Battery never visible to friends — private AI input only.
- "Not this time" replaces "Decline" — soft social language throughout.
- CORS allows all origins in production (line 55) — needs tightening.
- InvitePage.tsx exists but has no route — invite links 404.

### Security & Privacy Audit (5 Critical)
1. **Plaintext OAuth tokens** in users table → Supabase Vault encryption (AES-256-GCM).
2. **Social Battery leaking** to friends via `/dashboard` → stripped from response.
3. **Hardcoded developer email** in AuthContext.tsx:65 → removed.
4. **protobufjs RCE** → npm audit fix.
5. **Zero RLS policies** despite RLS enabled on 18 tables → defensive policies added.

### Architecture Decisions
- **RLS Strategy:** Defensive policies (Option A). Service-role bypass = zero runtime cost. Policies activate if anon/authenticated role hits DB. `auth.uid()` maps to Supabase Auth not Firebase Auth — safety net for non-service-role scenarios.
- **Token Encryption:** Supabase Vault (pgsodium) with `oauth_tokens` table. Vault handles key rotation natively. Protects DB dump/backup exposure.
- **Meetup Race Condition:** AFTER UPDATE trigger with FOR UPDATE lock. Serializes concurrent acceptance atomically. App code keeps notification logic.
- **Implementation order:** Trigger (0.5d) → RLS (1-2d) → Token migration (2-3d).

### Two-Way Calendar Sync
- Watch channels scaffolded (webhook endpoint, columns, secret) but `calendar.events.watch()` never called — 80% wired.
- `syncUserCalendar()` does full fetches — no sync tokens.
- `google_event_id` on `meetup_participants` links Slotted ↔ Google Calendar events.
- Feedback loop prevention: track `rsvp_source` to avoid infinite push-back.
- Calendar = source of truth for individual RSVP. Slotted = source of truth for multi-party state.

### Groups Feature Scope
- Fully implemented (2 tables, 5 endpoints, ~400 lines FriendsPage UI) but `GroupAvailability` is NOT group-specific — accepts any `friendIds[]`.
- Removal: Drop tables/endpoints/UI, rename to MultiFriendAvailability, rename endpoint.
- Risk: `pending_invites` migration must cleanly drop `group_id` column and restore unique constraint.

### Beta Feedback
- Tamer: auto-calendar add (done), two-way sync (pending), no duplicate notifications (fixed).
- Emma: doesn't maintain calendar — app must work without perfect calendar hygiene.
- Tom: parent/couple use case validates V2 backlog item 7b.

## Cross-Project Lead Knowledge (injected 2026-05-02)

### From EatDiscounted (Keaton)
- **Rate limiting critical** for public endpoints with quota-limited APIs.
- **Accessibility from day one.** Retrofitting harder than building in.
- **VPS simpler than Vercel** for SSE/streaming.

### From MyDailyWin (Revali, alumni)
- **Code duplication kills:** 65+ functions × 3 files. Consolidation eliminated ~4,400 lines.
- **Firestore security:** `request.auth != null` = any authenticated user modifies any data. Same as RLS-without-policies.
- **localStorage key contracts:** Inconsistent keys between pages broke data flow.
- **innerHTML security:** 73 uses with user data. Sanitization must be shared.

### From Scrunch (Sandy)
- **TS6 + Supabase:** `select('*')` returns `never` without Views/Functions/Relationships. Cast with `as unknown as Type[]`.
- **PR conflicts:** Adapt incoming to new architecture, don't revert migrations.
- **Performance:** Static imports defeat lazy-load. Auth loading gate = blank screen on cold start.
- **Legal:** Product names safe, paraphrased descriptions safe, attribution essential, no video/images.

### From HealthStitch (Mal)
- **Cross-platform:** Web + iOS sharing same backend — decisions serve both surfaces.

### Inherited from Mai (Strategist)
- **"Week 4 feature on Day 1" problem.** State-aware progressive disclosure: unlock by milestones (0→1→3+ friends).
- **Day 1 flow:** OAuth → Calendar → Invite → Friend joins → Single suggestion → Book (< 3 min).
- **Option C scheduling:** "How about Saturday 2pm?" — one suggestion + action beats ranked lists.
- **Dual CTA anti-pattern.** Empty states cascade = "this app has nothing for me."
- **Events page = "a different product"** (1683 lines, 4 tabs) — non-negotiable V2 deferral.
- **Principles:** Scope discipline, "default is NO", complexity-is-cost, smart features need dumb UX.

## Session Archive Summary

Toph completed 8+ sessions: full architecture review (monolith assessment, file analysis), two-way calendar sync architecture design (4-phase plan), Groups feature scope analysis (removal plan), security & privacy audit (5 critical + 7 high findings), 3 architecture decisions (RLS policies, Vault encryption, meetup trigger), Mai strategy integration, and cross-agent coordination for remaining audit fixes. Key role: architectural decision-maker ensuring security-first, defense-in-depth patterns.
