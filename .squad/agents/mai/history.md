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
- **Interest badges on friend cards are AI data, not user data**: "You and Alex both like Comedy" tells the user what they already know about their own friend. These serve the AI's event ranking (V2), not the user's scheduling decision (V1).
