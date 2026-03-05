# Ty Lee's Apple Design Review

**Date:** 2025-07-25  
**From:** Ty Lee (UI Designer)  
**Inputs:** Suki's Product Design Audit, Mai's Product Strategy Review, Suki's Response, actual codebase  
**Lens:** Apple design principles — radical simplicity, every pixel earns its place, beauty through restraint

---

## 1. First Impressions

I spent 20 minutes skimming the actual codebase. Here's what Jony Ive would say:

**"This is a feature demo, not a product."**

The Dashboard alone is 2,034 lines of TypeScript. The `ACTIVITY_OPTIONS` array has 11 items with emojis. `TIME_OPTIONS` has 4 items with emojis. `CANCEL_REASONS` has 6 items with emojis. There's a `HowItWorks` component that renders 5 collapsible steps with paragraph explanations. The state management tracks `markBusyMode`, `busyBlockJustSaved`, `dragStart`, `dragEnd`, `isDragging`, `pendingBlocks`, `dismissingActivity`, `didntHappenId`, `cancellingMeetupId`, `expandedMeetupId`, `acceptingMeetupId`, `calendarModal`, `sharingMeetupId`, `shareUrl`...

This is the opposite of Apple's philosophy. Apple ships fewer features, not more. The iPhone launched with 16 apps. The original iPod had one button.

**The vibe:** Walking into a kitchen store where every wall is covered with gadgets. You came to buy a pan. You leave with nothing because decision paralysis set in.

**What it should feel like:** Opening the Notes app on iPhone. There's nothing to learn. There's nothing to configure. You write. It saves. It's already there when you come back.

The current Slotted UI communicates: "Look at everything I can do!" 

The ideal Slotted UI communicates: "Let's schedule time with Alex."

---

## 2. On Suki's Audit

Suki correctly diagnosed the symptoms. 297 buttons. 108 emojis. 15+ dashboard sections. Her inventory is accurate and necessary — you can't cut what you haven't counted.

### Where She's Right

**Groups removal.** Unambiguously correct. The multi-friend selection already handles the use case. Groups is a concept that needs explaining, which means it doesn't earn its pixels.

**3-section Dashboard proposal.** Directionally correct — Upcoming, Catch Up, CTA is a reasonable framework. The problem isn't her structure; it's that she assumed the structure should exist for all users.

**Emoji policy.** Her strict 13-emoji list is close. I'd go to 8. The traffic lights (🟢🟡🔴) for social battery are correct — they're universal. The ✅⏳ state indicators work. The ⭐ for ratings works. Everything else can be an icon or text.

**Notifications merge.** Collapsing 3 tabs to 1 is correct. Three tabs for actionable items is absurd.

### Where She Doesn't Go Far Enough

**The 3-section Dashboard assumes content exists.** Suki's wireframe shows Upcoming + Catch Up + CTA. For a new user: that's 2 empty sections with headers ("Upcoming" header with nothing under it) and 1 CTA that can't be completed. Empty sections with headers are worse than nothing — they highlight absence.

**The Friend cards retain too much metadata.** Her proposal strips Groups but keeps "📅 Calendar connected" and "Last seen: 3 weeks ago" on every card. That's still two pieces of info competing for attention per card. The only thing that matters is: can I schedule with this person?

**84 emojis was her "functional" count.** That's still 84 emojis. Her strict audit got to 13 — that should have been her first proposal, not her fallback.

### Where She Goes Too Far

Nothing. Suki was appropriately conservative. Her audit identified what's wrong without being reckless about what's right.

---

## 3. On Mai's Product Strategy

Mai asked the right question: **"Does a brand-new user with zero friends need to see ANY of this?"** 

The answer is no. And Mai built her entire review from that insight.

### Where She's Right

**"Every feature is designed for Week 4. Nothing is designed for Minute 1."** This is the single most important sentence in either document. It's the entire thesis, and it's correct.

**State-aware progressive Dashboard.** This is the architectural fix. Not "simplify the Dashboard" — make the Dashboard reflect reality. 0 friends = invite CTA only. 1 friend = schedule CTA only. 3+ friends = Catch Up row appears. This is how Apple's apps work: features reveal themselves when they become relevant.

**Single-suggestion scheduling.** "How about Saturday at 2pm?" with one button is how friends talk. Showing 8 ranked time slots with 🔥👍🤔😐 scores is how spreadsheets talk. The escape hatch ("See other times →") handles control-oriented users.

**Kill Events entirely.** Not demote — kill. Events is a different product inside the scheduling app. 1,683 lines of code for feature-rich event discovery is a distraction. A user browsing concert listings is NOT moving toward booking time with Alex.

**Zero onboarding questions.** OAuth → Connect Calendar → Dashboard. One setup screen. "Preferred times" can be learned from behavior. Asking a question before the user has context is asking a question they can't meaningfully answer.

**Hangout logging → star rating.** A 6-field form (date, friend, activity, duration, time of day, vibe) is a data entry product inside a scheduling app. "How was hanging with Alex? ⭐⭐⭐⭐⭐" is one tap.

### Where She Doesn't Go Far Enough

**The scheduling escape hatch placement.** Mai's mockup shows "See other times →" as a small link below the Book button. That's correct for Day 1 users — the single suggestion should dominate. But she didn't specify how this evolves. After 2 hangouts, the escape hatch should have more weight. After 5, maybe show the list by default. Progressive disclosure works in both directions.

**The empty state design.** Mai correctly identifies that the "nearly-empty screen IS the product" for Day 1 — but she doesn't specify what that screen should FEEL like. An empty Dashboard can feel either broken or intentional. The difference is visual design: generous whitespace, warm typography, a single piece of art or illustration, and microcopy that makes the emptiness feel like potential, not absence.

### Where She's Wrong

**Kill the help page entirely.** Mai says: "The app should be self-explanatory. No /help page." This is ideologically pure but practically naive. I've worked on dozens of "self-explanatory" apps. Zero of them achieved 100% comprehension. A hidden help resource (Settings → Help, or a subtle "?" in the header) costs nothing. It catches edge cases. It reduces support burden. The existence of a help page doesn't mean the app failed — it means the app planned for reality.

---

## 4. On The Three Disagreements

### a) Notifications: Kill the Page (Mai) vs. Lightweight Dropdown (Suki)

**Apple's answer: Dropdown.**

Apple doesn't do "kill the notifications system." The iPhone has a dedicated notification center — but it's accessed via gesture (swipe down), not a tab. Notifications exist. They're just not a destination you navigate TO.

**Suki is right.** Kill the full-screen Notifications *page* with its tabs and UI patterns. Keep a lightweight notification *list* accessible from the bell icon — a sheet or dropdown that shows unread items with action buttons. This matches iOS patterns: notifications are accessible from anywhere without being a "place."

The inline banners Mai proposes work for 1-2 items. When a user has 5 pending meetup invites, banners become a wall of cards obscuring actual content. The dropdown is the overflow handler.

**Verdict:** Kill the page. Keep a bell icon that opens a sheet. Badge shows unread count.

### b) Scheduling Escape Hatch: Small Link (Mai) vs. Expandable Section (Suki)

**Apple's answer: Depends on user maturity.**

Look at how Apple handles this in Maps directions. When you start navigation, it shows one route. But there's a "Routes" button that expands to show alternatives. It's not buried as a tiny link — it's a visible but secondary affordance.

**Suki's modification is better.** Mai's "See other times →" link is too hidden. Users who want control will miss it or feel patronized. Suki's version:

```
How about Saturday at 2pm?

[ Book it ]

Other times that work ↓
```

The "Other times" label with a ↓ chevron communicates that alternatives exist without demanding attention. Tapping expands 3-4 inline options. The user never leaves the screen.

**One refinement:** After 3+ scheduled hangouts, consider showing 3 times by default (with the best one highlighted). The training wheels come off progressively.

**Verdict:** Expandable section, not link. But keep it collapsed by default for first-time users.

### c) Help Page: Nothing (Mai) vs. Discoverable /help (Suki)

**Apple's answer: Keep it hidden but available.**

Every Apple product has support documentation. The iPhone has Settings → General → About → Legal & Regulatory. There's a "Tips" app pre-installed. Apple doesn't eliminate help — they make it invisible until needed.

**Suki is right.** A discoverable /help page (Settings → Help, or a "?" icon) is a safety net. It costs zero screen real estate. It costs zero cognitive load for users who don't need it. It catches the 5% of users who are confused at 11pm.

Mai's position ("the app should be self-explanatory") is an aspiration, not an implementation decision. You can aspire to self-explanatory AND have a help fallback. They're not mutually exclusive.

**Verdict:** Kill the dashboard banner. Kill inline explainers. Keep a minimal /help page accessible from Settings. Don't promote it.

---

## 5. What Both Missed

### Typography Hierarchy

Looking at the code, I see a lot of `text-sm`, `text-xs`, `font-semibold`, `text-gray-800`, `text-gray-500`, `text-gray-400`. The Tailwind classes suggest there's no clear typographic scale — everything is ad-hoc.

Apple has exactly three text weights visible on most screens: a headline, body, and caption. That's it. The current Slotted code suggests text sizes and weights are chosen per-component rather than from a system-level scale.

**What's missing:** A defined type scale. Something like:
- Page title: 20px semibold
- Section header: 16px semibold  
- Card title: 14px medium
- Body text: 14px regular
- Caption/metadata: 12px regular gray-500
- Legal/fine print: 11px regular gray-400

Every piece of text should map to one of these levels. If it doesn't fit, the content structure is wrong.

### Color Usage

The codebase has `slotted-50`, `slotted-100`, `slotted-200`, `slotted-700`, `slotted-800`, plus `purple-50/30`, `gray-100`, `gray-400`, `gray-500`, `gray-800`, `gray-900`. Gradients like `from-slotted-50/40 to-purple-50/30`.

**Apple's color philosophy:** Color is signal, not decoration. Blue means tappable. Red means destructive. Green means success. That's basically it. Everything else is grayscale.

**What's wrong:** Gradients on buttons, tinted backgrounds, multiple shades of brand color all visible at once. This creates visual noise. When everything is slightly colored, nothing stands out.

**What should happen:** One accent color for primary actions. Gray scale for everything else. Color enters only for state (success/error/warning) and primary CTAs.

### Animation and Transitions

The code has `animate-in slide-in-from-top-2 fade-in` on the HowItWorks expanded state. That's good — animation should be purposeful.

**What's missing from the discussion:** Neither Suki nor Mai addressed micro-interactions. When the Dashboard transforms from "invite mode" to "schedule mode" because a friend joined, that's an emotional moment. It shouldn't just... appear. A brief celebratory animation (the friend's avatar expanding, a subtle glow, a "Alex is here!" message that fades) turns a state change into a moment.

Apple's signature: animation that makes reality feel responsive. When you delete an app on iOS, the icons wiggle and the deleted app shrinks and fades. It FEELS like something happened. Slotted's key moments need the same treatment.

### Information Density

**Dashboard:** Even Suki's simplified 3-section proposal has ~15 discrete pieces of information visible at once (greeting + stat line + section header + 2 hangout cards + section header + 3 avatars + section header + CTA button).

**Apple's rule of thumb:** One thought per viewport at a time. On iPhone, when you're composing a message, you see the keyboard and the compose field. Not your inbox AND the compose field AND suggested contacts AND a banner.

The Dashboard should show ONE thing at a time based on context:
- No friends → Just the invite CTA. Full screen.
- Friend pending → Just "Alex invited you! Accept?" Full screen.  
- Friend joined → Just "Alex is here! Find times →" Full screen.
- Hangout upcoming → The hangout card prominently. Maybe a secondary action below.

Scrolling for more content is fine. Cramming more content above the fold is not.

### The Empty State Feeling

Neither audit deeply designed the empty state. "Welcome to Slotted. Invite a friend." is correct copy — but what does that LOOK like?

An empty state can feel:
- **Broken:** White screen with a button. Feels like something failed to load.
- **Sad:** "You have no friends" energy. Highlights what's missing.
- **Inviting:** "Let's get started" energy. The emptiness is potential.

The empty Dashboard needs: generous whitespace, a friendly illustration (not a stock photo — something hand-drawn or abstract), warm microcopy, and ONE button that feels like a natural next step.

### Navigation Patterns

The AppShell has 4 bottom nav items: Home, Friends, Inbox, Settings.

**Apple's pattern for 4 items:** Fine. The tab bar can comfortably hold 4-5 items. But Settings is NOT a daily action. Most apps put Settings behind a profile icon or gear in the header, not in the primary nav.

**Better:** Home, Friends, Inbox (3 bottom tabs). Settings accessible from a profile avatar/icon in the header.

This also clears space if Events returns in V2 — you have a slot.

### Card Design

Both audits assume cards are the right metaphor. Let me challenge that.

A card implies containment — a bounded object with information inside. Cards are correct for: things you might take action on individually, things that represent discrete entities (a friend, a hangout, an event).

Cards are WRONG for: simple lists of options, settings, navigation. The current Friends page uses cards for friend entries. But a friend isn't really a "card" — they're a list item. A simple row with avatar + name + tap target would be cleaner and more scannable.

**Apple's approach:** Cards in Apple apps are reserved for rich content (a song in Apple Music, a photo in Photos, a note in Notes). Lists use simple rows.

**Recommendation:** Friend entries should be list rows, not cards. The card elevation, rounded corners, and padding create visual noise when repeated 8 times.

---

## 6. Ty Lee's Ideal V1

If I redesigned Slotted from scratch with Apple's "100 no's for every yes":

### Screens: 4 total

1. **Connect** — OAuth + calendar connection (one screen, one action)
2. **Home** — Context-aware: shows exactly what you need right now
3. **Friends** — Simple list of friends + invite action
4. **Settings** — One scrollable page with "Advanced" collapsed

No Notifications page. No Events page. No separate onboarding flow.

### Home Screen States

**State 0: No calendar connected**
```
Connect your calendar to get started

Slotted finds times when you and your friends 
are both free.

[ Connect Google Calendar ]
```
Full screen. Nothing else.

**State 1: Calendar connected, 0 friends**
```
You're set up! Now invite a friend.

Slotted finds times that work for both of you.

[ Share invite link ]
      ⬇
   Message · Email · Copy
```
Full screen. The share options appear as a secondary row, not 3 competing buttons.

**State 2: 1 friend pending**
```
Alex wants to connect!

[ Accept ]   [ Not now ]
```
Full screen. When something requires action, it gets full attention.

**State 3: 1 friend, calendar synced**
```
You and Alex are connected 🎉

Ready to find time to hang out?

[ Find times with Alex → ]
```
Full screen. The celebration is brief. The action is obvious.

**State 4: First scheduling**
```
How about Saturday at 2pm?

Alex is free. You're free. ☕ Coffee?

[ Book it ]

Other times ↓
```
One suggestion. One button. Escape hatch collapsed.

**State 5: Hangout booked**
```
You're meeting Alex!

Saturday, January 25 · 2pm
Added to Google Calendar ✅

[ Done ]
```
Confirmation. Gratitude. Closure.

**State 6: 1+ upcoming hangout**
```
Coming up

┌─────────────────────────────┐
│  Coffee with Alex           │
│  Saturday · 2pm             │
│                    View →   │
└─────────────────────────────┘

[ Invite another friend ]
```
The hangout card is the hero. Secondary action at bottom.

**State 7: 3+ friends, 2+ hangouts completed**
Now — and only now — does the Dashboard show:
- Upcoming section (if hangouts exist)
- "Time to reconnect?" row with 2-3 avatars
- Invite CTA at bottom

This is the "mature" state. It unlocks over time.

### Friends Screen

```
Friends

┌────────────────────────────┐
│ [Avatar]  Alex Chen        │→
│           Last week        │
├────────────────────────────┤
│ [Avatar]  Jamie Wong       │→
│           3 weeks ago      │
├────────────────────────────┤
│ [Avatar]  Sam Taylor       │→
│           Yesterday        │
└────────────────────────────┘

+ Invite a friend
```

No cards. Simple list rows. Avatar, name, last interaction, chevron. The entire row is tappable → goes to scheduling.

No Groups section. No interest badges. No calendar sync status. No Local vs Long Distance segmentation.

Multi-select: tap and hold a friend to enter selection mode. Select 2+ → "Find time for 3 friends" button appears as a floating bar at bottom. No separate UI for this.

### Settings Screen

One scrollable page.

```
Settings

CALENDAR
┌────────────────────────────┐
│ Google Calendar            │
│ Connected ✓      Disconnect│
└────────────────────────────┘

ACCOUNT
┌────────────────────────────┐
│ Display name: Shari        │
│ Sign out                   │
│ Delete account             │
└────────────────────────────┘

Advanced ↓
```

Tapping "Advanced" expands: travel buffer, preferred times, recharging days, all the power-user settings. Collapsed by default. Most users never open it.

### Navigation

Bottom tab bar: **Home · Friends · Inbox** (3 items)

Inbox is a badge on the bell icon. Tapping opens a sheet overlay, not a full page. Sheet shows unread items with inline actions (Accept/Decline for friend requests and meetup invites).

Settings: accessible from profile avatar in header.

### Emotional Arc

| Time | What happens | Feeling |
|------|--------------|---------|
| Minute 0 | Sign up + connect calendar | "That was fast" |
| Minute 2 | Invite a friend | "Simple, I'll text Alex" |
| Day 2 | Alex joins, calendar syncs | "Oh cool, it worked!" |
| Day 2+30s | "How about Saturday 2pm?" → Book | "That was... 10 seconds?" |
| Day 2+1min | Confirmation, calendar updated | "Okay, this actually works" |
| Week 2 | Notification: "Haven't seen Jamie in 3 weeks" | "Oh right, I should text Jamie" |
| Month 1 | Looking at upcoming hangouts list | "I'm actually seeing my friends more" |

The arc is: confidence → delight → surprise → loyalty. Every feature that appears before its moment BREAKS the arc.

---

## 7. Final Verdict

### Graded Recommendations

| # | Recommendation | Verdict | Notes |
|---|----------------|---------|-------|
| 1 | State-aware progressive Dashboard | ✅ Ship it | The single most important change. |
| 2 | Kill Events page | ✅ Ship it | Non-negotiable. 1683 lines for a different product. |
| 3 | Kill Notifications page vs. dropdown | 🔧 Adjust | Kill the PAGE, keep a dropdown/sheet from bell icon. |
| 4 | Settings → 1 page with accordion | ✅ Ship it | Calendar + Account visible. Everything else collapsed. |
| 5 | Strip friend cards to avatar + name + last seen | 🔧 Adjust | Correct direction, but use list rows, not cards. |
| 6 | Zero onboarding (calendar connect only) | ✅ Ship it | One screen. One button. |
| 7 | Single suggestion scheduling for first-time | ✅ Ship it | "How about Saturday?" is how friends talk. |
| 8 | Star rating for hangout logging | ✅ Ship it | One tap. Not six fields. |
| 9 | Hide Social Battery until 3+ hangouts | ✅ Ship it | Features reveal when relevant. |
| 10 | Remove score emojis | ✅ Ship it | 🔥👍🤔😐 creates decision paralysis. |
| 11 | /help page: Suki (keep) vs Mai (kill) | 🔧 Adjust | Kill all inline help. Keep a hidden /help accessible from Settings. |
| 12 | 13-emoji policy | 🔧 Adjust | Go to 8. Keep 🟢🟡🔴✅⏳⭐⚠️❤️. Kill the rest. |

### Summary Scores

- **Suki's audit:** 8/10 — Correctly diagnosed symptoms. Could have gone further.
- **Mai's strategy:** 9/10 — Correctly identified root cause. /help deletion is wrong.
- **Suki's response:** 9/10 — Right on all three disagreements.

### The One Thing

If Shari implements only ONE recommendation from all these documents, it should be:

**The state-aware progressive Dashboard.**

Everything else is refinement. The progressive Dashboard is the architectural shift that makes the app feel simple for new users AND functional for returning users. It's the answer to "every feature is designed for Week 4" — you only show Week 4 features to Week 4 users.

---

## Addendum: Visual Design Priorities

If I were allocating design energy, here's the priority order:

1. **Empty state design** — The invite-only Dashboard needs to feel warm and intentional, not broken.
2. **Type scale** — Define 5 text levels and enforce them globally.
3. **Color reduction** — One accent color. Everything else grayscale.
4. **State transitions** — When Dashboard changes state (friend joins, hangout booked), animate the moment.
5. **Card → list conversion** — Friend entries become simple rows.
6. **Navigation simplification** — 4 tabs → 3 tabs. Settings to header.

The app doesn't need a redesign. It needs a diet. The bones are right. The features work. The AI matching is clever. But the visual layer is drowning in stuff that doesn't earn its pixels.

**Strip. Then polish what remains.**

---

*Ty Lee, UI Designer*  
*"Simplicity is not the absence of clutter. That's a consequence of simplicity. Simplicity is somehow essentially describing the purpose and place of an object and product."*  
*— Jony Ive*
