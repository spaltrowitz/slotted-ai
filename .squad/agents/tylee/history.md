# Ty Lee — History

## Project Context
**Project:** Slotted — AI-powered friendship maintenance app (React PWA)
**Owner:** Shari Paltrowitz
**Stack:** React 19 + TypeScript + Tailwind CSS v4 + Vite, Firebase backend, Supabase PostgreSQL
**Status:** Post-beta, receiving feedback that the app is too "busy" — unclear CTAs, too many emojis, too many features competing for attention

## Learnings

### Session 2025-07-25: Apple Design Review

**Key files reviewed:**
- `docs/plans/research-product-design-audit.md` — Suki's 108-emoji, 297-button inventory
- `docs/plans/research-product-strategy-review.md` — Mai's "Week 4 vs Minute 1" thesis
- `docs/plans/suki-response-to-mai.md` — Convergence on 8/11 recommendations
- `client/src/pages/DashboardPage.tsx` — 2034 lines, confirms visual density problem
- `client/src/pages/FriendsPage.tsx` — Groups, Local/Long-Distance segmentation still present
- `client/src/components/AppShell.tsx` — 4-item bottom nav (Home, Friends, Inbox, Settings)

**Architecture decisions:**
- State-aware progressive Dashboard is THE architectural fix — show different UI based on user stage
- Dashboard states: 0 friends → invite only; 1 friend → schedule CTA; 3+ friends → Catch Up row
- Friend cards should become list rows, not cards — cards imply containment, rows imply scannable list
- 4 bottom tabs → 3 (Home, Friends, Inbox); Settings moves to header avatar

**Design patterns:**
- Apple's "100 no's for every yes" — every pixel must earn its place
- Empty states must feel intentional, not broken — warm whitespace + illustration + single CTA
- Type scale: define 5 levels (page title, section header, card title, body, caption) and enforce globally
- Color: one accent for primary actions, grayscale for everything else, color only for state

**Emoji policy:**
- 13 emojis → recommend 8: 🟢🟡🔴 (battery), ✅⏳ (state), ⭐ (rating), ⚠️ (warning), ❤️ (saved)
- Remove all score emojis (🔥👍🤔😐) — creates decision paralysis
- Remove all decorative emojis adjacent to text labels

**Three disagreements resolved:**
1. Notifications: Kill page, keep dropdown/sheet from bell icon
2. Scheduling escape hatch: Expandable section (not tiny link), collapsed by default
3. Help page: Kill inline help, keep hidden /help in Settings as safety net

**Output:** `docs/plans/tylee-apple-design-review.md`
