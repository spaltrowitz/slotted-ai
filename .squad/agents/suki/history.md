# Suki — History

## Key Patterns & Corrections

### Product Design & UX Audit
- **Core finding:** Slotted's aha moment ("see overlapping times, book in 10 seconds") is buried under 15+ dashboard sections, 4-tab notifications, Groups feature that duplicates multi-friend selection, and 24 decorative emojis.
- **Dashboard:** Buries "Find times with a friend" beneath calendar, pending/confirmed hangouts, events, activity. Users ask "what do I do first?"
- **Groups removal:** Adds ~160 lines of UI but only provides "save friend selection" convenience. Multi-friend scheduling already handles the use case. Beta feedback confirms not needed.

### Feature Tiering
- **Tier 1 (Core):** OAuth, calendar sync, friends, 1:1 and multi-friend availability, booking, RSVP, upcoming view.
- **Tier 2 (Enhance):** Apple/Outlook calendar, social battery, preferences, hangout logging, push notifications.
- **Tier 3 (Remove):** Groups, Dashboard calendar, Events page, Smart Event Picks, Activity Feed, "How It Works" banners.

### Emoji Policy
- **Strict audit results:** 100 unique emojis (678 instances) → KEEP 13 → further reduced to 8 (🟢🟡🔴✅⏳⭐⚠️❤️).
- **4-criteria test:** If text label exists next to emoji, emoji is redundant. 87% reduction, 93% instance reduction.
- **Keep only:** Traffic-light status, checkmarks, star, warning, heart, hourglass.
- **Replace with text:** Activity pickers, time-of-day, cancel reasons, event categories, score emojis, notification types, settings preferences, button-label emojis.

### Design Principles
- **Settings minimize "teaching" copy.** Label controls, let users act. Explanations in onboarding, not settings.
- **Mobile-first, single-column layouts** over grids for value-prop sections. Dark backgrounds risky on landing pages.
- **Surgical iteration:** Don't rebuild sections from scratch — refine what's there.
- **Duplicate CTAs = decision paralysis.** When two compete with equal weight, neither wins.
- **Avoid duplicate emojis** across landing page sections. Audit for uniqueness.

### Settings Cleanup
- Removed verbose section subtitles ("We use this to..."), collapsed share-hangout toggle, removed Social Battery + Event Interests info boxes. Tightened spacing (space-y-10→6, p-5→4). Mobile scroll reduced ~30%.
- Removed duplicate "Get started with Google" button from footer.

### Alignment with Mai & Ty Lee
- **Mai's temporal dimension** (WHEN features appear) is more impactful than structural removal (WHAT). Progressive disclosure by milestones subsumes most structural simplification.
- **Ty Lee adjustments:** Notifications → keep dropdown/sheet (not inline banners only). Friend list → list rows (not cards). Help page → keep hidden in Settings. Emojis 13→8.
- **Agreements:** State-aware progressive Dashboard, Events removal non-negotiable, zero onboarding questions (calendar connect only), strip friend cards, hide Social Battery until 3+ hangouts, hide score emojis.
- **Disagreements:** Notifications page should exist (inline banners don't scale). "See other times" needs visual weight. Keep /help page (costs nothing).
- **Key learning:** Future design should ask "for this user at this moment" not "for this page."

### UI Complexity Audit
- 297 buttons, 108 emojis (84 functional, 24 decorative). Primary issue: decision paralysis.
- DashboardPage: 2034 lines, ~15 competing sections.
- Navigation: "Inbox" label doesn't match `/notifications` route. Avatar and Settings nav both go to Settings (redundant). 4 nav items appropriate.

## Cross-Project Designer Knowledge (injected 2026-05-02)

### From EatDiscounted (Verbal)
- **SSE streaming as UX differentiator:** Progressive results create excitement.
- **Community reports as social signal:** "Not found" should feel helpful, not empty.

### From MyDailyWin (Sidon)
- **Celebration psychology:** Modal + confetti + sound, not just toast. PWA install prompt = retention lever.
- **Dark mode must be universal.** Unused CSS keyframes = dead code.

### From Scrunch (Jan)
- **Prose-inspired homepage:** Single mission statement, one CTA, progressive disclosure.
- **"No pre-browse gates, ever."** Behavioral personalization > explicit profiling.
- **44px touch targets.** One mention is enough — repeated copy dilutes.

### From HealthStitch (Book — UX Writing)
- **Voice:** Smart, personal, encouraging. Loading states conversational. Error framing: user intent first.
- **Tab labels:** Task-oriented and short.

## Owner Preferences (learned)
- Distinct visual identities per landing section — monotonous card styles are a readability concern
- Prefers mobile-first, single-column layouts over grids for value-prop sections
- Dark backgrounds risky on landing — lighter treatments with subtle differentiation safer
- Keep changes surgical — refine, don't rebuild

## Session Archive Summary

Suki completed 8+ sessions: landing page redesign iterations (Early Access badge, "Why It Matters" section variants), full product design & UX audit (feature tiering, 8 key recommendations), settings cleanup (~30% scroll reduction), strict emoji audit (100→8 unique emojis, 87% reduction), "Why It Matters" copy rewrite (5 cards), response to Mai's product strategy, Ty Lee Apple design review alignment, and UI complexity audit (297 buttons cataloged). Key contribution: establishing progressive disclosure as core design paradigm.
