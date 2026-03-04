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

### 2026-03-04 Team Update — Settings & Login Fixes (Suki)

**Settings cleanup:** Removed all verbose section subtitles, collapsed share-hangout toggle, removed Social Battery + Event Interests info boxes, tightened spacing from space-y-10 to space-y-6 and p-5 to p-4. Mobile vertical scroll reduced ~30%.

**Login fix:** Removed duplicate "Get started with Google" button from footer. Kept single CTA in hero section.
