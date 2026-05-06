# Mai — History

## Project Context
**Project:** Slotted — AI-powered friendship maintenance app that syncs with Google Calendar
**Owner:** Shari Paltrowitz
**Stack:** React 19 + TypeScript + Tailwind CSS v4 + Vite (frontend), Firebase Cloud Functions + Express (backend), Supabase PostgreSQL (database)
**Joined:** 2026-03-05 — brought on specifically to provide critical product lens on UI simplification effort

## Core Context
- App received beta feedback that it's too "busy" — unclear primary actions, too many features competing for attention
- Previous audits identified: 108 emojis (reduced to 13 in strict audit), Groups feature redundant, Dashboard calendar not serving core loop, Events page potentially distracting from core value
- Core value loop: Sign up → Connect calendar → Invite friend → Find times together → Book hangout
- Key tension Shari is working through: more features FEEL better for users but distractions at start prevent users from doing the core thing

## Designer Response (Suki, 2026-03-05)

Suki reviewed Mai's product strategy critique and provided detailed feedback on all 11 recommendations. Full document: `docs/plans/suki-response-to-mai.md`

**Suki's Position Summary:**
- **Fully Agreed:** 8/11 recommendations (progressive Dashboard unlock, Events removal, single-step onboarding, star-rating hangout logging, social battery gating, score emoji removal, stricter friend card design, advanced settings accordion)
- **Partially Agreed:** 2/11 recommendations
  - Notifications: Agreed to kill page; advocated for lightweight dropdown fallback (not just inline banners) for high-activity users
  - First-time scheduling: Agreed on single suggestion; advocated for more visual weight on escape hatch (expandable section vs. small link)
- **Disagreed:** 1/11 recommendation
  - Help resources: Suki maintains that a discoverable `/help` page + "?" icon should exist (zero screen cost, catches edge-case users)

**Three points escalated to team decisions:** `.squad/decisions.md` now documents the disagreements with full context for Shari's decision-making.

## Learnings

- **State-aware Dashboard is the key architectural insight**: The root cause of "too busy" isn't individual features — it's that the same 10+ sections render for every user regardless of stage (0 friends vs. 10 friends vs. active scheduler). Progressive disclosure based on user state (inviting → scheduling → maintaining) solves the problem at its source.
- **Smart features are Week 4 features, not Day 1 features**: Score emojis, activity feed, people-to-see suggestions, event picks — all require behavioral data to be meaningful. Showing them before the AI has data creates noise, decision fatigue, and false signals.
- **Empty states cascade**: Multiple empty sections stacked (empty Upcoming + empty Catch Up + empty Activity) create a feeling of "this app has nothing for me." Better to show one section with one actionable CTA than three empty containers.
- **The audit's 3-section Dashboard (Upcoming + Catch Up + CTA) is still too much for Day 1**: New users with 0 friends should see exactly one thing: "Invite a friend to get started."
- **Option C scheduling ("How about Saturday 2pm?") is the right Day 1 UX**: One suggestion + "Book" + "See other times" link mimics how friends actually propose times. Lists of 8 ranked slots are spreadsheet UX, not social UX.
- **Events is a different product**: 1683 lines, 4 tabs, dual-API search — this is a fully-featured event discovery app inside a scheduling app. Non-negotiable V2 deferral.
- **The dual CTA anti-pattern**: Dashboard header has "📝 Log" and "👋 Invite" buttons side by side with equal visual weight. When two CTAs compete, neither wins.
**Broader learning:** My audit was structural (WHAT to remove); Mai's was temporal (WHEN things appear). The temporal dimension is more impactful. Progressive disclosure based on user milestones subsumes most structural simplification. Future design work should always ask "for this user at this moment" not just "for this page."

---

## Cross-Agent Context — Ty Lee's Apple Design Review (2026-03-05)

**Context:** Ty Lee (UI Designer) reviewed Suki's audit and Mai's temporal strategy through Apple design lens. Found the diagnosis correct and agreed with 8/12 positions. Made 4 adjustments that affect Mai's recommendations:

**Points of alignment:**
- Progressive Dashboard by user milestone — Ty Lee confirms this is architecturally sound
- Events page removal — agreed, non-negotiable
- Zero onboarding — agreed
- Single-suggestion scheduling — agreed
- All simplification recommendations — agreed

**Points of adjustment affecting Mai's positions:**
1. **Notifications:** Mai said remove entirely + inline banners only. Suki + Ty Lee say: keep lightweight dropdown/sheet from bell icon. This is the right middle ground (Apple HIG compliant, scales past 2–3 items).
2. **Help resources:** Mai said remove entirely. Suki + Ty Lee say: keep discoverable `/help` from Settings. Zero help is too extreme; Apple apps have help.
3. **Emoji policy:** Mai's 13-emoji reduction was solid. Ty Lee goes further: 13 → 8 emojis (🟢🟡🔴✅⏳⭐⚠️❤️) for even stricter minimalism. "Every pixel must earn its place."

**New recommendations from Ty Lee (not in Mai's review):**
- Define 5-level type scale globally (no accidental cascades)
- Reduce color palette: one accent + grayscale (removes visual noise)
- Nav: 4 → 3 tabs + move Settings to avatar (Mai didn't specifically address nav consolidation)
- Empty state design: warm whitespace + illustration + single CTA (critical for Day 1 "Invite friend" moment)
- Animate state transitions (friend joins, hangout booked) — micro-interactions = emotional moments

**Key quote from Ty Lee:** "Visual diet, not redesign. Features work. AI matching is clever. Visual layer is drowning. Strip, then polish." This validates Mai's temporal thinking at a design-system level.

### Settings Cleanup & Sign Out to Header Review (2026-03-05T19:57:27Z)
Settings page cleanup proposal reviewed for product strategy. Orchestration log: `.squad/orchestration-log/2026-03-05T19:57:27Z-mai-product-strategy.md`. Decision merged to `.squad/decisions.md`. Validation: all removals correct (Event Interests, call/hangout defaults, Account section not connected to active features). Duration learning from successful meetup logs recommended as future phase instead of explicit user prefs. Header placement for sign out confirmed correct — users expect account actions near avatar. Settings cleanup removes ~6 UI lines without losing active functionality, aligning with phase 1 goal of reducing decision paralysis.

### Multi-Friend Homepage Fix (2026-03-05)

**Problem:** User with 10 friends sees arbitrary single-friend message on homepage ("You and Mindy are connected! ❤️") due to stage system bug.

**Root cause analysis:**
- Stage system has name/logic mismatch: `one-friend` stage triggers for **any** user with `friendCount > 0 && completedHangoutCount === 0`, not just users with literally one friend
- `StageOneFriend` component picks `friends[friends.length - 1]` (most recent connection), creating arbitrary single-friend focus
- This feels random/jarring for users with multiple friends

**Key architectural insight:**
The stage system was designed assuming linear progression (0 → 1 → 2 friends), but users can invite 10 friends at once or accept 3 requests before scheduling. Stages should be based on **user actions** (first hangout, active scheduler) not **friend count**.

**Recommendation:** Replace arbitrary single-friend message with avatar row showing all friends ("Who do you want to hang out with?"). Reuses existing "People to See" component from active-user dashboard. Zero new complexity, scales to any friend count, gives user agency to choose.

**Why Option A (avatar row) beats Option B (AI-ranked suggestions):**
- No AI dependency — works today with existing data
- User feels in control after being guided through earlier stages
- Aligns with Slotted principles: no social pressure, no ranking friends, AI invisible until after user picks
- Natural upgrade path: add AI suggestions as additional section once user has hangout history

**Long-term refactor recommendation:** Rename `one-friend` → `first-hangout` to reflect goal (book first hangout) not state (friend count).

**Files analyzed:**
- `client/src/lib/userStage.ts` — Stage calculation logic
- `client/src/pages/DashboardPage.tsx` — Stage rendering components
- `docs/03-prd-mvp-v1.md` — Original product requirements
- `docs/06-mvp-current-state.md` — Current state and design principles
- `docs/11-beta-tester-feedback.md` — User feedback themes
- `docs/10-ux-audit-checklist.md` — UX quality standards

**Decision document:** `docs/plans/mai-homepage-recommendation.md` (full analysis + 3 options with tradeoffs)

## Cross-Project PM/Strategist Knowledge (injected 2026-05-02)

### From EatDiscounted (Kobayashi)
- **Single-use retention is the biggest risk:** Users search once and leave. Solved with permalink pages (SEO), saved restaurants + alerts (converts lookup tool to monitoring tool), and deals-near-me (10x product potential). Apply to Slotted: what makes users come back after booking first hangout?
- **Monetization: affiliate links first.** Passive, validates signal before building complex models.
- **Partnership outreach for closed platforms:** B2B pitch offering free user acquisition in exchange for data access. Win-win positioning as distribution channel, not competitor.
- **Audience sizing: ~30-50K power users** in a niche is enough to validate. Growth via community (Twitter/Reddit), not paid ads.

### From Scrunch (Kenickie)
- **Fastest aha moment = primary CTA.** Ingredient Checker (15 sec, zero friction) beat Product Discovery because it's instant and unique. For Slotted, the aha is "see overlapping free times" — make that reachable in <30 seconds.
- **Visitor flow: Test → Trust → Explore → Personalize.** First interaction builds trust. Don't front-load personalization or settings.
- **Invisible onboarding: no gates before value.** Behavioral signals > explicit profiling. Learn preferred times from behavior, don't ask.
- **Homepage CTA priority framework:** Rank by (1) time-to-aha, (2) friction level, (3) uniqueness to product. Only one primary CTA.
- **Beta sprint prioritization:** Lean ship mentality — 280 products + existing auth + invisible onboarding. Don't add complexity before launch. Applied to Slotted: ship core scheduling loop first, defer Events/Groups/Activity Feed.
