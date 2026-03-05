# Suki — History

## Project Context

**Project:** Slotted — AI-powered friendship maintenance app that syncs with Google Calendar
**Owner:** Shari Paltrowitz
**Stack:** React 19 + TypeScript + Tailwind CSS v4 + Vite (frontend), Firebase Cloud Functions + Express (backend), Supabase PostgreSQL (database)
**Key files:** `client/src/` for all frontend code, `client/src/components/` for shared components, `client/src/pages/` for page components

## Learnings

- Joined team 2026-03-03. Ready for design tasks.
- Landing page lives in `client/src/pages/LoginPage.tsx` — serves both authenticated (dashboard link) and unauthenticated (sign-in CTA) users. Route is `/` and `/login` in App.tsx.
- Custom CSS in `client/src/index.css`: `gradient-btn` (teal→cyan→indigo), `gradient-text` (matching), `gradient-hero` (dark slate), `gradient-warm` (pink/violet/blue). Font-display is Outfit.
- Design tokens include Slotted indigo scale (50–950), warm accents (coral, peach, lavender, sunset, pink), accent teal (#06b6d4), and social battery colors.
- Landing page redesign (2026-03-03): Fixed Early Access badge — shifted from teal (conflicted with CTA) to amber/orange gradient with ✨ sparkle and urgency copy. Differentiated "Why It Matters" from "How It Works" by wrapping benefits in a dark slate-900 panel with frosted glass cards (bg-white/[0.06]) — creates strong visual break from the light pastel cards in "How It Works."
- User preference: Shari wants distinct visual identities per landing section. Monotonous card styles across sections are a readability concern.
- Landing page revision (2026-03-03): User feedback — dark gradient panel for "Why It Matters" didn't land. Replaced with single-column, smaller stacked cards with colored left-border accents on white/70 backgrounds. Much more mobile-friendly.
- User preference: Avoid duplicate emojis across landing page sections. Early Access badge switched from ✨ to 🎟️ to not clash with "Get suggestions" step. Always audit for emoji uniqueness across the page.
- User preference: Shari prefers mobile-first, single-column layouts over grid layouts for value-prop sections. Dark backgrounds are risky on landing pages — lighter treatments with subtle differentiation (left borders, typography changes) are safer.
- User preference: When iterating on feedback, keep changes surgical — don't rebuild sections from scratch, refine what's there.
- LoginPage had a duplicate "Get started with Google" button — one in the hero CTA and a second "Bottom CTA" section near the footer. Removed the bottom duplicate (2025-07-25). Only one sign-in CTA should exist on the page.
- Settings page cleanup (2025-07-25): Removed all "We use this to..." section subtitle explanations — they read as the app justifying itself rather than helping the user. Section headers now show just the title. Inline helper text on sub-fields shortened or removed. Share hangout toggle card collapsed from toggle + separate status box into a single row with dynamic subtitle. Social Battery summary box removed (redundant with selection). Event Interests info box removed. Feedback section header shortened. Section gap reduced from space-y-10 to space-y-6, card padding from p-5 to p-4. Net effect: ~30% less vertical scroll on mobile.
- Design principle: Settings pages should minimize "teaching" copy. Users already chose to be on the page — label controls clearly and let them act. Explanations belong in onboarding, not settings.
- UI Complexity Audit (2025-07-25): App has 297 buttons across pages. 108 total emojis used (84 functional, 24 decorative). Primary issue: decision paralysis — users don't know what action to take because too many elements compete. DashboardPage (2034 lines) has ~15 competing sections. Groups feature adds entire UI section but duplicates multi-friend selection capability.
- Emoji usage patterns: Functional emojis = state indicators (🟢🟡🔴), category icons (🎭🎵⚽), pickers (🌅☀️🌆🌙), feedback (⭐✅). Decorative emojis = button label redundancy (📝 Log, 👋 Invite, ✨ Find times), page title decoration (🎯), time-of-day in greeting when text already says "Good morning".
- Groups feature analysis: Adds ~160 lines of UI (section, cards, create form, management panels, GroupAvailability component) but only provides "save friend selection" convenience. User feedback: "Groups feature isn't needed — selecting multiple friends already handles group scheduling". Feature creates cognitive overhead without clear value over ad-hoc multi-friend selection.
- Primary action visibility problems: Dashboard buries "Find times with a friend" beneath calendar, pending/confirmed hangouts, events, activity. Friends page buries friend list beneath Invite and Groups sections. Events page splits into 4 tabs with no clear entry point. Users land on pages and must hunt for what to do.
- Navigation clarity: "Inbox" label doesn't match `/notifications` route. Avatar and Settings nav both go to Settings (redundant). 4 nav items is appropriate scope.

### 2026-03-04 Team Update — Settings & Login Fixes (Suki)

**Settings cleanup:** Removed all verbose section subtitles, collapsed share-hangout toggle, removed Social Battery + Event Interests info boxes, tightened spacing from space-y-10 to space-y-6 and p-5 to p-4. Mobile vertical scroll reduced ~30%.

**Login fix:** Removed duplicate "Get started with Google" button from footer. Kept single CTA in hero section.

### 2025-07-25 — "Why It Matters" card copy rewrite (Suki)

**Rewrote all 5 feature cards** in LoginPage.tsx (lines 142–172):
- **Orphan fixes:** "Hang out on your terms" → "Plans, not promises"; "Make it a real plan" → "Skip the group text". No more short words orphaning on mobile.
- **Groups support:** "both of you" replaced with "for a friend or the whole group" — covers 1:1 and group use cases.
- **Privacy card honesty:** Removed "Never event titles, details, or who you're meeting with" (misleading given newsfeed sharing). New copy: "We only see free or busy, never details. You control what friends can see."
- **Replaced weak card:** "Find something fun" (event discovery, tertiary feature) replaced with "Zero scheduling hassle" — speaks to Slotted's core value of eliminating back-and-forth scheduling.
- **Emoji dedup:** Card 1 changed from 📅 to 🗓️ to avoid conflict with "How It Works" step 1. Card 4 changed from 🎫 to ⚡.

### 2025-07-25 — Full Product Design & UX Audit (Suki)

**Core finding:** Slotted's aha moment ("see overlapping times, book in 10 seconds") is buried under 15+ dashboard sections, 4-tab notification structure, Groups feature that duplicates multi-friend selection, and 24 decorative emojis. Users ask "what do I do first?" instead of immediately scheduling.

**Key recommendations documented in `docs/plans/research-product-design-audit.md`:**

1. **Remove Groups entirely** — duplicates multi-friend selection, adds ~160 lines of UI, beta feedback confirms not needed
2. **Remove Dashboard calendar view** — user already has Google Calendar, doesn't enable core action
3. **Consider removing Events page from V1** — distracts from core friend scheduling loop
4. **Simplify Dashboard to 3 sections:** Upcoming, Catch up avatars, Find times CTA
5. **Merge 3-tab Notifications into single unified list** — actionable items first, then chronological
6. **Reduce Settings from 4 tabs to 2** — Account + Preferences
7. **Reduce nav from 4 to 3 items** — move Settings to user menu
8. **Cut 24 decorative emojis** — keep 84 functional ones

**Feature tiering established:**
- **Tier 1 (Core):** OAuth, calendar sync, friends, 1:1 and multi-friend availability, booking, RSVP, upcoming view
- **Tier 2 (Enhance):** Apple/Outlook calendar, social battery, preferences, hangout logging, push notifications
- **Tier 3 (Remove):** Groups, Dashboard calendar, Events page, Smart Event Picks, Activity Feed, "How It Works" banners

**Emoji policy defined:** Use emojis only for state indicators (🟢🟡🔴), category icons, pickers, and feedback. Remove emojis that duplicate adjacent text labels (📝 Log, 👋 Invite, ✨ Find times).

**Beta feedback addressed:**
- Tamer: Simplified dashboard shows value immediately
- Emma: Multi-friend scheduling (her interest) stays core; calendar removal helps non-calendar-native users
- Tom: Multi-friend selection handles parent/playdate use case without Groups overhead

### 2025-07-25 — Strict Emoji Audit & How It Works Relocation (Suki)

**Trigger:** Shari said 84 "functional" emojis is still way too many. Default stance must flip to text-first.

**Strict audit results:**
- Applied 4-criteria test to all 100 unique emojis (678 instances)
- **KEEP: 13 emojis** — only traffic-light status (🟢🟡🔴), checkmarks (✅✓✕), star (⭐), warning (⚠️), heart (❤️), hourglass (⏳)
- **REPLACE WITH TEXT: 72 emojis** — activity pickers, time-of-day, cancel reasons, event categories, score emojis, notification types, settings preferences, platform pickers, all button-label emojis
- **REMOVE: 15 emojis** — decorative (empty states, personality emojis, flourishes)
- **87% reduction** (100 → 13 unique), **93% instance reduction** (678 → ~45)

**Key insight:** Every emoji-with-text-label pair fails the test. If there's a text label next to the emoji, the emoji is redundant. This covers activity pickers (11), time-of-day (4×3 sets), event categories (10×3 sets), notification types (10), and all Settings preference pickers (~15).

**How It Works relocation:** Both Dashboard and Events "How It Works" sections should move to a dedicated `/help` page, accessible from Settings and a subtle "?" affordance. Dashboard becomes 100% actionable, Events search tab is cleaner.

### 2026-03-05 — Mai Joins Team as Product Strategist

**New hire:** Mai (Product Strategist) joined the team to provide critical product review and "less is more" counterweight to feature expansion.

**Mai's core positions** (from `docs/plans/research-product-strategy-review.md`):
- Dashboard must be state-aware, progressively unlocking features by user milestone (0→1→3+ friends, hangout count, time on platform)
- Day 1 experience should be: OAuth → Calendar → Invite → Friend joins → Single suggestion ("How about Saturday 2pm?") → Book → Done in <3 min
- Events page should be removed from V1 entirely (not demoted, removed)
- Social Battery, Activity Feed, Hangout Logging, advanced settings gated behind milestones
- First-time scheduling uses single suggestion, not ranked lists
- Onboarding is 1 step (calendar connect), preferred times learned from behavior

**Alignment with Suki's work:**
- Mai's progressive disclosure aligns with emoji reduction (removes visual chaos)
- Both recommend removing Events page
- Mai goes deeper on WHEN features appear, not just WHAT to remove

### 2025-07-25 — Response to Mai's Product Strategy Review (Suki)

**Reviewed Mai's full critique at `docs/plans/research-product-strategy-review.md`.** Response written to `docs/plans/suki-response-to-mai.md`.

**Key areas of agreement with Mai:**
- State-aware progressive Dashboard is the single most important change — my fixed 3-section proposal created "empty state cascade" for new users
- Events removal should be non-negotiable, not optional — I was too timid
- Zero onboarding questions (1 step: calendar connect) — preferred times should be learned from behavior
- Strip friend cards to avatar + name + last seen — interest badges and sync status are noise
- Hangout logging simplified to star rating for early interactions — 6-field form is excessive
- Hide Social Battery until 3+ completed hangouts — it's a power-user control
- Hide score emojis entirely — 🔥👍🤔😐 creates decision fatigue
- Settings: single page with "Advanced" accordion beats my 2-tab proposal

**Key areas of disagreement with Mai:**
- Notifications: killing the page entirely is too aggressive — inline banners don't scale past 2-3 items. Keep a lightweight notification sheet/dropdown, not a full page.
- First-time scheduling (Option C): single suggestion is right, but the "See other times" escape hatch needs more visual weight — expandable section, not a small link.
- Removing ALL help resources: a discoverable /help page (from Settings or subtle "?" icon) costs nothing and catches users who are genuinely confused. Pragmatism over ideology.

**Broader learning:** My audit was structural (WHAT to remove); Mai's was temporal (WHEN things appear). The temporal dimension is more impactful. Progressive disclosure based on user milestones subsumes most structural simplification. Future design work should always ask "for this user at this moment" not just "for this page."
