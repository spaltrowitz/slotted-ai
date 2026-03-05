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
