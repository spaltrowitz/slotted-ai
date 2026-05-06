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

## Cross-Project Designer Knowledge (injected 2026-05-02)

### From EatDiscounted (Verbal)
- **SSE streaming creates emotional payoff:** Progressive results appearing one-by-one is the product's differentiator. Finding deals should feel like a win, not a status report. Apply this "reveal moment" thinking to Slotted's scheduling flow.

### From MyDailyWin (Sidon)
- **Celebration modals > toast notifications:** Level-ups, streak milestones, and big wins need full modal + confetti + sound. Toast-only celebrations feel underwhelming. Relevant for Slotted's hangout-booked and friend-joined micro-interactions.
- **Exponential easing creates suspense:** Deceleration curves (60ms → 360ms) make randomized/delayed reveals feel fair and exciting vs. linear intervals.
- **PWA install prompt is critical for retention:** Daily-use apps need `beforeinstallprompt` handler. Slotted should have this.
- **Visual consistency audit:** Three different font stacks across pages, ~45 hardcoded hex values, varying border-radius = visual chaos. CSS variables + design tokens solve this.

### From Scrunch (Jan)
- **Homepage: lead with mission, not features.** Single powerful headline, one CTA, social proof. Progressive disclosure on scroll.
- **Mobile-first, single-column layouts** for value-prop sections. Dark backgrounds risky on landing pages — lighter treatments with subtle differentiation are safer.
- **44px minimum touch targets** (Apple HIG alignment). Auth form inputs, community buttons, and help buttons commonly miss this.
- **Collapsible filters on mobile:** 15+ options at 375px = cognitive overload. Toggle with active-count badge.
- **Remove non-functional UI:** "Coming soon" buttons erode trust. Remove entirely until feature exists.
- **Footer must earn its space:** Strip to essentials — tagline + nav links. Move donation/support asks to About page.

### From HealthStitch (Book — UX Writing)
- **Voice consistency:** Smart, personal, encouraging — never clinical or corporate. Apple-esque clean aesthetic for legal/static pages.
- **Null states:** Em-dash "—" for missing data reads as intentional absence, not bug.
- **Loading states:** Conversational and specific, not generic "Loading..."
- **Error framing:** Lead with user intent before technical detail.
