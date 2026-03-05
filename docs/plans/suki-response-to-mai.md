# Suki's Response to Mai's Product Strategy Review

**Date:** 2025-07-25  
**From:** Suki (Designer)  
**To:** Shari, Mai  
**Re:** `docs/plans/research-product-strategy-review.md`

---

## The Honest Version

Mai's review is the best thing that's happened to this project since the beta feedback. She took my audit — which correctly identified the *symptoms* — and diagnosed the actual disease. My audit was structural (what to remove). Hers is temporal (when things should appear). That's the dimension I missed, and it matters more.

Her thesis — "Every feature in Slotted is designed for Week 4. Nothing is designed for Minute 1" — is a perfect summary of the core bug. I should have said it first. I didn't because I was thinking about the app as it exists, not the app as a new user experiences it.

That said, Mai pushes too far in a few places. Here's where I land on each recommendation.

---

## Recommendation-by-Recommendation

### 1. State-Aware Progressive Dashboard

**Agree — this is the single most important change.**

My audit proposed a fixed 3-section Dashboard (Upcoming + Catch Up + CTA). Mai correctly pointed out that for a user with 0 friends, that's two empty sections and a CTA that can't be completed. The "empty state cascade" is real. I've seen it kill onboarding flows.

Mai's progressive unlock is better:
- 0 friends → just the invite CTA
- 1 friend, 0 hangouts → friend's face + "Find times"
- 1+ hangouts → Upcoming appears
- 3+ friends → "Catch Up" row appears
- 5+ hangouts → Activity insights

This is more engineering work (milestone tracking, conditional rendering), but it's the right trade. The Dashboard should reflect where the user IS, not where the app hopes they'll be.

One addition I'd make: the transitions between states should feel celebratory, not just "new section appeared." When a friend joins and the Dashboard shifts from invite-mode to schedule-mode, that moment is the emotional peak. A brief animation or warm confirmation ("Alex is here! Let's find a time") makes the unlock feel earned.

### 2. "How About Saturday at 2pm?" Single Suggestion (Option C)

**Partially agree — right for first interaction, but the escape hatch needs more weight.**

Mai's Option C for first-time scheduling is brilliant UX psychology. It mimics how real friends suggest times. "How about Saturday at 2pm?" with a Book button is faster and less intimidating than a ranked list of 8 scored slots.

Where I push back: Mai's mockup shows "See other times →" as a small link. For first-time users, that's fine. But some users — planners, people with complicated calendules — will feel controlled by a single suggestion. The escape hatch needs to be visually present enough that control-oriented users see it without hunting.

My modification:
```
How about Saturday at 2pm?

[ Book it ]

Other times that work ↓
```

The "Other times" is a collapsed section, not a navigation link. Tapping it expands 3-4 alternatives inline. The user never leaves the screen, never feels shuttled somewhere else. This keeps Mai's simplicity while respecting users who want to choose.

After the first hangout, show the full list (Option A) by default. The single-suggestion training wheels come off once the user knows how the app works.

### 3. Kill Events Page Entirely

**Agree — and Mai's right that I was too timid.**

My audit listed Events removal as "recommended" but framed it as one of two options. Mai called me on it: "It shouldn't be optional." She's right. 1683 lines of code for event discovery is a different product living inside a scheduling app. Every time a user scrolls through concert listings, they're NOT moving toward their first hangout.

Kill it. The `EventSharePage` can stay as a standalone public URL (it's a sharing endpoint, not a feature), but the Events nav item, Smart Event Picks, Saved Events, and all four tabs should be removed from the authenticated app. V2 conversation.

### 4. Kill Notifications Page

**Partially disagree — inline banners are right for now, but we need a fallback.**

Mai's argument: for V1 with <50 users, actionable items should appear as banners on the relevant pages (friend requests on Friends, meetup RSVPs on Dashboard). I like this. It puts actions where they make contextual sense instead of siloing them on a separate page.

Where I diverge: banners work when there are 1-2 pending items. When a user has 5 friends all sending meetup invites in the same week, inline banners on the Dashboard become a wall of cards before the user reaches their actual content. The bannner approach doesn't scale, even at modest activity levels.

**My position:** Kill the Notifications *page* as a full-screen destination with its own tabs and UI patterns. Keep a minimal notification *list* accessible from the nav bell icon — a simple dropdown/sheet that shows unread items chronologically with action buttons. Not a page. A lightweight overlay. This gives us the contextual banners Mai wants PLUS a catch-all for users who miss inline items.

### 5. Settings: Single Page with "Advanced" Accordion

**Agree — Mai's version is better than my 2-tab proposal.**

My audit went from 4 tabs to 2 (Account + Preferences). Mai goes to 1 page with three visible sections (Calendar, Account, Advanced accordion). That's cleaner. The mental model is simpler: you scroll one page, you see what matters, and "Advanced" is clearly labeled as optional.

The 20+ power-user settings (recharging days, travel buffer, neighborhoods, office days, call windows, etc.) all belong behind that accordion. A new user never needs to open it. An experienced user knows where to find it.

One nuance: the Calendar section should be first and visually prominent because it's the one setting that directly affects the core experience. If your calendar isn't connected, nothing else matters.

### 6. Strip Friend Cards to Avatar + Name + Last Seen

**Partially agree — strip the metadata, but keep a scheduling affordance.**

Mai's right that interest badges, sync status, and hangout cadence on friend cards are noise. The interest badges (🎭🎵⚽) tell users what they already know about their own friends. Sync status is the AI's concern, not the user's. Cadence display creates subtle pressure ("you haven't seen Alex in 3 weeks" on every card = guilt).

Strip all of it. Avatar + name + last seen is clean.

Where I add: the card still needs a *tap-to-schedule* affordance. Not a full button with "Find times" text — just make the card itself tappable, leading to the availability view. If a user visits the Friends page, their intent is almost certainly "I want to schedule with someone." The card should be the entry point, not a read-only display that requires navigating to a detail page first.

So: avatar + name + last seen + the entire card is a tap target. No buttons on the card. No metadata. Clean.

### 7. Zero Onboarding Questions

**Agree — I should have cut deeper the first time.**

My audit trimmed onboarding from 8 steps to 2 (calendar connect + preferred times). Mai cuts to 1 (calendar connect only). She's right. "Preferred times" is a question that can't be meaningfully answered before using the app. The user doesn't know what "preferred times for hangouts" means in Slotted's context yet.

The AI should learn preferred times from the first 2-3 scheduling interactions. That's literally what progressive profiling is designed for. The fact that we still ask upfront means we're not trusting our own system.

OAuth → Connect Calendar → Dashboard. One setup screen. Done.

### 8. Hangout Logging → Just Star Rating

**Agree — the 6-field form is a product inside a product.**

The current hangout logging form asks for: date, friend, activity, duration, time of day, and vibe rating. That's a data entry task, not a user experience. For the first several interactions, all the AI needs is a signal: did this go well?

A star rating after a completed hangout gives the AI enough to start learning. "How was hanging out with Alex? ⭐⭐⭐⭐⭐" — one tap, done. The full logging form can unlock after 5+ hangouts for users who want to be detailed.

Mai nailed the framing: the form is a "product inside a product." It serves the AI's needs, not the user's.

### 9. Hide Social Battery Until 3+ Completed Hangouts

**Agree.**

The Social Battery is a power-user control for managing social energy. Showing it before the user understands the app introduces a concept they don't need yet. Default to "Open," let the AI handle energy management invisibly, and surface the toggle only after the user has enough experience to understand what it does.

My audit already moved Social Battery out of onboarding. Mai takes it further by gating it in Settings behind a hangout count. That's the right call. The battery should feel like a discovery, not a requirement.

### 10. Hide Score Emojis Entirely on Time Slots

**Strongly agree — my strict emoji audit already flagged this.**

The 🔥👍🤔😐 scoring system creates decision fatigue. "Is 72% good enough or should I wait for a better slot?" is a question that shouldn't exist. Time slots should be presented as available times, not graded recommendations.

Mai and I converge here. Even when the AI has behavioral data (5+ hangouts), I'd use subtle visual differentiation (a gentle color warmth gradient, slightly bolder text on top options) rather than score emojis or percentages. The AI's opinion should influence sort order, not create visible judgment.

The `scoreEmoji()` function should not render. Period.

### 11. Remove "How It Works" Completely

**Disagree — remove the banner, keep a discoverable help resource.**

Mai's position: no "How It Works" banner, no `/help` page. The app should be self-explanatory. I agree with the first part. The banner on the Dashboard occupies prime real estate and nobody reads 5 paragraphs of instructions inline.

Where I disagree: "the app should be self-explanatory" is an aspiration, not a guarantee. I've never shipped a product where 100% of users immediately understood every interaction. A discoverable help resource — a small "?" icon in the nav or a "Help" link in Settings — costs nothing. No user is forced to see it. No screen real estate is consumed. But the user who's confused at 11pm has somewhere to go instead of uninstalling.

**My position:** Kill the Dashboard banner. Kill the Events "How Events Work" section. Move the content to a minimal `/help` page accessible from Settings and a subtle "?" in the header. If nobody visits it, great — the app is self-explanatory. If 5% of users do, we saved 5% of users.

This is pragmatism over ideology. The existence of a help page doesn't mean the app failed to be intuitive. It means we planned for edge cases.

---

## On Mai's Broader Thesis

**"Every feature in Slotted is designed for Week 4. Nothing is designed for Minute 1."**

This is correct, and it's the insight my audit was circling without landing on.

My audit identified the symptoms: too many dashboard sections, competing CTAs, emoji overload, Groups duplication. I counted buttons (297), categorized emojis (108), and mapped user flows. That was necessary work — you can't fix what you haven't measured.

But I was thinking about the app as a *static artifact.* I was asking "what should be on this page?" Mai asked the better question: "what should be on this page *for this user at this moment?*" That temporal dimension is the difference between a simplification pass and a product strategy.

Where I still push back on Mai's approach:

**1. Engineering complexity is real.** The progressive unlock system (milestone tracking, conditional rendering per user state, transitions between Dashboard modes) is significant engineering work. We're trading UX simplicity for codebase complexity. It's the right trade, but it's not free. The implementation needs to be clean — a single `getUserStage()` function that determines what renders, not scattered conditionals across 2000 lines.

**2. The "nearly-empty screen IS the product" claim needs design support.** A screen with one CTA and nothing else can feel either elegantly simple or broken. The difference is visual design. The invite-only Dashboard needs to feel intentional, warm, and complete — not like a loading state. This is where my work comes in: the progressive stages need distinct, polished visual identities so the user never thinks "is something missing?"

**3. Not every user is a Day 1 user.** Mai's review is laser-focused on the new user experience, and she's right that it's the most broken part. But we also have returning users with 5-8 friends who need a functional Dashboard. The progressive unlock system has to work in BOTH directions — simple for new users, rich for power users. The same architectural change that serves Day 1 must not hobble Week 4.

---

## What Changes

Here's where I update my own recommendations based on Mai's review:

| My Original Position | Updated Position |
|---------------------|-----------------|
| Dashboard: fixed 3 sections | Dashboard: state-aware progressive unlock (Mai's model) |
| Events: "recommended" to remove | Events: non-negotiable removal from V1 |
| Notifications: merge to 1 tab | Notifications: inline banners + lightweight notification sheet (not a full page) |
| Settings: 4 → 2 tabs | Settings: 1 page with "Advanced" accordion |
| Onboarding: 8 → 2 steps | Onboarding: 1 step (calendar connect only) |
| Friend cards: remove Groups, keep metadata | Friend cards: avatar + name + last seen only, card is tap target |
| Score emojis: remove (already agreed) | Score emojis: remove, use subtle gradients post-5 hangouts |
| Hangout logging: simplify form | Hangout logging: star rating only for first interactions |
| How It Works: move to /help | How It Works: kill banner, keep discoverable /help |
| First scheduling: show simple list | First scheduling: single suggestion with expandable alternatives |

---

## Summary

Mai is right about the big picture. The app needs to be designed for Minute 1, and everything else should unlock progressively. I agree with 8 of her 11 recommendations outright, partially agree on 2 (Notifications page, first-time scheduling UX), and disagree on 1 (removing all help resources).

The three places I hold ground:
1. **Notifications need a lightweight fallback** beyond inline banners — a dropdown/sheet, not a page.
2. **First-time scheduling's escape hatch** needs more visual weight than a small link — an expandable section, not a navigation.
3. **A discoverable /help page should exist** even if the app is self-explanatory — it costs nothing and catches edge cases.

Everything else, Mai called correctly. The progressive Dashboard is the single most impactful architectural change, and it subsumes most of what my audit was trying to achieve structurally.

Let's build this.

---

*Suki, Designer — Slotted*
