# Product Strategy Review — Critical Lens

**Date:** 2025-07-25
**Author:** Mai (Product Strategist)
**Inputs:** UI Simplification Research, Groups Removal Research, Product Design Audit, MVP Current State, Beta Feedback, PRD, actual page source code
**Purpose:** Challenge assumptions, push toward radical simplicity, answer Shari's "smart features" question

---

## Executive Summary

The previous audit was good but not brave enough. It correctly identified Groups as redundant and the Dashboard as bloated, but it stopped short of the hard question: **Does a brand-new user with zero friends need to see ANY of this?**

The answer is no. Slotted's Day 1 experience should be a near-empty screen with one obvious action. The current app shows a user 10+ sections, 297 buttons, and the conceptual weight of an app they haven't earned yet. This is the "blank canvas loaded with furniture" problem — you've furnished a house before the owner has moved in.

**My thesis:** Every feature in Slotted is a feature for Week 4. Nothing in Slotted is designed for Minute 1. That's the core bug.

---

## 1. The "Smart Features" Paradox

Shari asked the right question. Let me answer it directly for each AI-powered feature.

### Smart Scheduling Suggestions (AI ranks time slots)

**When it's valuable:** After the user has completed 2-3 hangouts and the AI has behavioral data (preferred times, durations, locations). The AI's rankings become meaningful when there are enough data points to differentiate a "great" slot from a "good" one.

**When it's noise:** On Day 1, when both friends have connected calendars for the first time. The AI has no preference history. Its "ranking" is based on generic heuristics (weekends > weekdays, evenings > mornings). The user doesn't know these rankings exist, doesn't know what the scores mean, and sees 🔥👍🤔😐 emojis next to time slots they have no framework to evaluate.

**The behavioral psychology:** This is the **paradox of choice** in action. Showing 8 ranked time slots with scores asks the user to evaluate quality when they just want to pick a time. On Day 1, a list of 3-4 available times with no scoring would produce faster decisions. The scoring system introduces a meta-question — "is 72% good enough or should I wait for a better slot?" — that shouldn't exist yet.

**Verdict:** Hide scores on the first 2 scheduling interactions. Show available times as a simple list. After the user has booked 2+ hangouts, introduce scoring as a subtle visual gradient (not emojis, not numbers). The `scoreEmoji()` function in `FriendAvailability.tsx` should not render at all until the AI has real behavioral data.

### "People to See" Suggestions

**When it's valuable:** After Week 2+, when the user has 4+ friends on the platform and the AI can detect who they haven't seen recently. The "catch up with" nudge becomes genuinely useful when it surfaces a friend you've been meaning to contact.

**When it's noise:** Day 1 to Week 1. The user has 0-2 friends. Showing "Catch up with" when there's 1 friend on the app is telling the user what they already know. It's not a suggestion — it's a restatement.

**The behavioral psychology:** This is **premature social proof**. The feature assumes a rich social graph that doesn't exist yet. The "People to See" section on the Dashboard (lines 1556-1603 in DashboardPage.tsx) renders a horizontal avatar row of up to 12 friends — but a new user with 1 friend sees a lonely single avatar in a row designed for many. This is worse than showing nothing because it highlights the emptiness.

**Verdict:** Don't show "People to See" until the user has 3+ friends AND has completed at least 1 hangout. Before that threshold, the Dashboard should focus on the invite-a-friend loop, not the reconnection loop. The current code shows the section whenever `friendsToSee.length > 0` — it needs a minimum threshold.

### Smart Event Picks

**When it's valuable:** Never in V1. Here's why: the core aha moment is "I picked a friend, Slotted found us a time, we booked it in 10 seconds." Event discovery is a different mental model entirely — it's "browse and hope something appeals." These are fundamentally different user intents.

**When it's noise:** Always, on the Dashboard. The section at lines 1616-1656 in DashboardPage.tsx shows event cards with images, dates, venues, "reasons" why they match, and friend avatars. This is a content-heavy section that competes with the core "schedule with a friend" action. A user scrolling through event picks is NOT moving toward their first hangout — they're browsing.

**The behavioral psychology:** This is **attentional capture** by irrelevant stimuli. Concert images and venue photos are visually rich and draw the eye away from the avatar row (which IS the core action). The user's brain allocates processing to "Oh, there's a comedy show Saturday" instead of "I should schedule time with Alex."

**Verdict:** Remove from Dashboard entirely. The audit recommended this but was too gentle about it. Events is a V2 feature. It doesn't belong on the most important screen of the app.

### Activity Feed

**When it's valuable:** After Week 3+, when the user has enough history that patterns emerge ("You haven't seen Alex in 3 weeks", "You usually hang out on weekends but have a free one coming up"). These insights require behavioral data that doesn't exist on Day 1.

**When it's noise:** Day 1 through Week 2. The Activity Feed at lines 1696-1756 shows items like overdue friends, recent activity, and "free weekend" nudges. For a new user, this is either empty (showing nothing) or showing trivial information ("You have a free weekend!" — yes, they know, they have no hangouts booked).

**The behavioral psychology:** This is the **blank canvas problem**. An empty activity feed communicates "nothing is happening" rather than "let's get started." Worse, the mere existence of the section implies the user *should* have activity, creating low-level anxiety about an empty app.

**Verdict:** Remove from Dashboard. Merge genuinely useful nudges (overdue friends) into the "People to See" section after Week 2+. Delete the free weekend nudge entirely — it's not useful information.

### Progressive Profiling

**When it's valuable:** Always, but invisibly. This is the one "smart" feature that should be running from Day 1 because it requires no UI. The AI learns from behavior (which times accepted, how long hangouts are) and improves suggestions silently.

**When it's noise:** When it's SHOWN to the user. The "Learned preferences" display in Settings exposes the AI's observations. A new user seeing "We've detected you prefer evening hangouts" after ONE evening hangout is seeing a false signal — a single data point isn't a preference. And showing AI-detected patterns violates the "AI is invisible infrastructure" design principle.

**Verdict:** Keep progressive profiling running in the background. Remove or deeply bury the "Learned preferences display" in Settings. If it must exist, gate it behind 5+ logged hangouts and label it as "Trends" not "Learned preferences" (which implies surveillance).

### Social Battery System

**When it's valuable:** After Week 2+, when the user understands the app and wants fine-grained control over how the AI treats their availability. The Social Battery (Open / Ask Me / Recharging) is a power-user control for managing social energy.

**When it's noise:** During onboarding and first interactions. The Social Battery was correctly moved out of onboarding, but it still lives prominently in Settings (SettingsPage.tsx line ~section 2 of Profile tab). A new user configuring their battery before they've used the app once is being asked to make a decision about a system they don't understand yet.

**Verdict:** The AI should default to "Open" and use the battery internally without the user ever touching it during the first 2 weeks. The setting should be collapsed/hidden in Settings until the user has scheduled 3+ hangouts. The battery indicator on friend cards (🟢🟡🔴) should not render until the user has manually changed their battery at least once.

---

## 2. Challenging the Previous Audit

The audit recommended keeping things I think should be challenged:

### Challenge 1: The Simplified Dashboard Still Has Too Many Concepts

The audit recommended: Upcoming + Catch Up + CTA. Three sections sounds minimal, but for a brand-new user with 0 friends:

- **Upcoming** → empty (no hangouts)
- **Catch Up** → empty (no friends)
- **CTA** → "Find times with a friend" (but there are no friends to find times with)

A first-time user would see two empty sections and a CTA that can't be completed yet. This is the **empty state cascade** — multiple empty states stacked create a feeling of "this app has nothing for me."

**My challenge:** Day 1 should have ONE section: a welcome state that says "Invite your first friend to get started" with a share button. That's it. No "Upcoming" header with nothing under it. No "Catch Up" row with zero avatars. Just the one action they can take RIGHT NOW.

The three-section Dashboard should progressively unlock:
1. **0 friends:** Welcome + Invite CTA only
2. **1 friend, 0 hangouts:** Friend's face + "Find times with [Name]" CTA
3. **1+ hangouts confirmed:** Upcoming section appears
4. **3+ friends:** "Catch Up" row appears
5. **5+ completed hangouts:** Activity insights start appearing

### Challenge 2: The Friends Page Showing All Friends at Once

The audit kept the full friend list as-is, just removed Groups. But a full friend list with Local/Long Distance sections, interest badges, calendar sync status, hangout cadence, and "Find times" buttons on every card is a LOT of information.

Consider: a user with 8 friends sees 8 cards, each with 4-5 pieces of metadata. That's 40+ data points on one screen. The user's actual need? Pick a friend and find times.

**My challenge:** The Friends page should be a simple contact list with just: avatar, name, last interaction time, and a tap-to-select affordance. No interest badges (who reads those?). No calendar sync status (the AI handles that). No hangout cadence display. These are data points for the AI's consumption, not the user's.

The interest badges (🎭🎵⚽ etc.) on friend cards are particularly egregious — they're showing the user what they already know about their own friends. "You and Alex both like Comedy" — yes, Alex is my friend, I know what they like. This information only helps the AI rank events, which is a V2 feature.

### Challenge 3: The Audit Was Too Timid on Events

The audit offered two options: remove Events or demote it. The recommended option (remove) was marked "recommended" but framed as optional. It shouldn't be optional.

The Events page is 1683 lines of code. It has 4 tabs, 9 category filters, a dual-API search (SeatGeek + Ticketmaster), saved events, a calendar view of saved events, and "How Events Work" banners. This is a fully-featured event discovery product embedded inside a scheduling app.

**My challenge:** Events should be cut entirely from V1. Not demoted, not moved behind a link. Cut. Every line of Events code is a line not spent on making the core scheduling experience perfect. The "Smart Event Picks" on the Dashboard, the "Saved Events" section, the Events nav item, the event sharing notifications — all of it.

When a user shares an event link, the EventSharePage can remain as a standalone public page. But the Events tab in the authenticated app should not exist until V2.

### Challenge 4: Settings Is Still Doing Too Much

The audit recommended reducing from 4 tabs to 2. I'd go further: Settings should be a single scrollable page with three visible sections:

1. **Calendar** — Connect/disconnect (this is the only setting that affects core functionality)
2. **Account** — Name, sign out, delete
3. **Everything else** — collapsed behind "Advanced preferences" accordion

The current Settings page has: social battery, recharging days, social frequency, social goal, travel buffer, personal time protection, planning style, preferred time windows, neighborhoods, office days, call windows, call platforms, manual availability, event interests, event city, hangout duration, call duration, push notifications, PWA install, feedback form, and 3 calendar provider panels.

That's 20+ settings. A new user doesn't need ANY of them to use the app. The AI should have sensible defaults. Settings is a trap that makes users feel they need to configure everything before the app "works."

### Challenge 5: The Notification Tab System

Even a unified single-tab notification list (as the audit recommends) might be over-engineered for launch. Most notification items are either:
- **Actionable:** Friend request, meetup RSVP → needs Accept/Decline buttons
- **Informational:** Friend accepted, meetup confirmed → just text

A simple two-state list (unread/read, actionable items at top) is correct. But the audit didn't question whether the notification PAGE needs to exist at all. Could actionable notifications appear as a banner on the Dashboard? Could friend requests appear inline on the Friends page? A separate Notifications page is another nav destination competing for attention.

**My challenge:** For V1 with < 50 users, consider killing the Notifications page entirely and showing actionable items as banners on the relevant pages (friend requests on Friends, meetup RSVPs on Dashboard). A notification badge in the nav can link to a simple list, but it doesn't need to be a full page with its own UI patterns.

---

## 3. What Day 1 Looks Like

### Minute 0: They sign up

**Current state:** Google OAuth → Onboarding (connect calendar + preferred times) → Dashboard with 10+ sections

**What they should see:** Google OAuth → Connect calendar (single screen, one button) → Dashboard with one element

The onboarding "preferred times" question should be DEFERRED. The user hasn't used the app yet — they don't know what "preferred times for hangouts" means in this context. They'll figure it out after their first scheduling interaction.

**Visible:** "Connect your Google Calendar" with a single button. One sentence explaining why: "Slotted finds times when you and your friends are both free."
**Hidden:** Everything else.

### Minute 2: Calendar connected, 0 friends

**What they should see:**

```
Welcome to Slotted, Shari.

Invite a friend to find times to hang out.

[ Share invite link ]

     Text  ·  Email  ·  Copy
```

That's the entire screen. No greeting emoji. No "How It Works" banner. No calendar view. No empty Upcoming section. No empty Catch Up row. Just the one thing they can do.

**Visible:** Invite CTA with share buttons.
**Hidden:** Dashboard sections, calendar, settings, notifications, everything.

### Minute 5–Day 2: First friend joins

**What changes:**

```
Shari, Alex just joined Slotted!

[ Find times with Alex ]

     Their calendar is connected — Slotted found 4 times
     that work for both of you.
```

The moment a friend joins and connects their calendar, the Dashboard transforms from "invite" mode to "schedule" mode. The primary action is no longer "invite" — it's "find times." This is the pivotal transition.

**Visible:** Friend's face + "Find times" CTA. If another invite would help, a subtle "Invite another friend" link at the bottom.
**Hidden:** Everything else. No "Upcoming" (nothing is scheduled yet). No "Catch Up" (there's only one friend).

### Minute 6: They tap "Find times with Alex"

**What they should see:**

A short list of available times. Not scored. Not ranked with emoji indicators. Just:

```
Times that work for you and Alex

  Saturday, 2:00 PM — 4:00 PM
  Sunday, 10:00 AM — 12:00 PM
  Next Tuesday, 6:00 PM — 8:00 PM

[ Book ]  (next to each time)
```

No 🔥 score. No "78% match" badge. No "AI suggests" label. No mode toggle (in-person / phone / video). Just times and a Book button.

**Why no mode toggle on first use:** The user is scheduling with a local friend they just invited. The default is in-person. Asking them to choose between "In person", "Phone call", and "Video call" before they've seen a single time slot is introducing a decision before it's needed. The toggle can appear after the first hangout, or when the user adds a long-distance friend.

**Visible:** Available time slots, Book button.
**Hidden:** Score emojis, match percentages, mode toggle, "How scheduling works" explainer, participant sync status details.

### Minute 7: They book a hangout

**What happens:** Tap "Book" → Confirmation appears → Event auto-added to both calendars.

No confirmation screen. No "choose a calendar" modal. Auto-add to primary Google Calendar. If the friend needs to accept, show a subtle "Sent — Alex will get a notification" message and return to the Dashboard.

**Visible:** Success confirmation, one-liner.
**Hidden:** Add to Calendar modal, calendar picker, RSVP flow details.

### Day 2: They come back

**What they should see:**

```
Good morning, Shari

Hangout with Alex — Saturday 2pm
  Confirmed ✅

[ Invite another friend ]
```

Now — and only now — does the Dashboard show an "Upcoming" section, because there's something upcoming. The CTA shifts to "invite another friend" because the scheduling loop is working and the next growth action is expanding the friend network.

**Visible:** Upcoming hangout card, invite CTA.
**Hidden:** Catch Up row (only 1 friend), Activity Feed (no history), Hangout History (no past hangouts), Events, Calendar view.

---

## 4. Feature Justification Matrix

I'm evaluating every feature from `docs/06-mvp-current-state.md` against one question: **Does this help or hinder the path from signup to first successful hangout?**

### REQUIRED (cannot complete first hangout without these)

| Feature | Why Required |
|---------|-------------|
| Google OAuth login | Identity |
| Google Calendar sync | Core data source |
| Invite friend (share link) | Can't schedule alone |
| Accept friend request | Complete the connection |
| 1:1 availability matching | THE core value |
| Book a hangout | Complete the action |
| Auto-add to calendar | Reduce friction at peak excitement |
| RSVP to meetup invite | Friend needs to respond |
| Upcoming hangouts view | See what's scheduled |

### MAKES IT EASIER (keep but simplify)

| Feature | Helps How | Simplification |
|---------|-----------|----------------|
| Push notifications | Friend gets notified of invite | Keep — but only for meetup invites. Don't push event suggestions, activity nudges, etc. |
| Soft RSVP flow (Accept/Maybe/Not this time) | Better than harsh Accept/Decline | Keep as-is — this is well-designed. |
| "People to See" suggestions | After 3+ friends, helps prioritize | Gate behind 3+ friends AND 1+ completed hangout. |
| Multi-friend availability | Group scheduling | Keep but don't promote until user has 3+ friends. |

### MAKES IT HARDER (hide or remove for new users)

| Feature | Why It's Harder | Recommendation |
|---------|----------------|----------------|
| **Onboarding survey (preferred times)** | Asks a question before user has context | Defer to after first hangout |
| **Social Battery toggle** | Introduces a concept the user doesn't understand yet | Default to "Open", hide for first 2 weeks |
| **Social frequency preference** | Meaningless without friends | Hide until 3+ friends |
| **Recharging days** | Power-user setting | Bury in Advanced preferences |
| **Travel buffer slider** | Power-user setting | Bury in Advanced preferences, use 30min default |
| **Personal time protection slider** | Power-user setting | Bury in Advanced preferences |
| **Planning style toggle** | Meaningless Day 1 | Bury in Advanced preferences |
| **Preferred time windows** | Can be learned from behavior | Bury in Advanced preferences |
| **Neighborhoods (home + work)** | Not needed for calendar overlap | Bury in Advanced preferences |
| **Office days** | Not needed for calendar overlap | Bury in Advanced preferences |
| **Call windows** | Needed only for long-distance friends | Show only after user adds a long-distance friend |
| **Call platforms** | Needed only for long-distance friends | Show only after user adds a long-distance friend |
| **Manual availability** | Workaround for non-calendar users | Show only if user skips calendar connect |
| **Dashboard calendar view** | Duplicates Google Calendar | Remove from Dashboard entirely |
| **How It Works banner** | Takes space, users learn by doing | Remove — show help via tooltip on first visit only |
| **Smart Event Picks** | Distracts from scheduling | Remove from Dashboard |
| **Saved Events section** | Duplicate of Events page | Remove from Dashboard |
| **Events page (all of it)** | Fundamentally different product | Remove from V1 |
| **Activity Feed** | Empty for new users, noise for returning users | Remove; merge useful nudges into People to See |
| **Hangout History + Log form** | Complex form on the main screen | Move to post-hangout prompt or Settings |
| **Hangout logging (full form)** | Date picker, friend selector, activity, duration, time, vibe rating — 6 input fields | Simplify to: "How was your hangout with Alex?" + star rating. ONE input, not six. |
| **"Didn't happen" flow** | Edge case on main screen | Move to notification/prompt |
| **Groups (saved collections)** | Redundant with multi-friend select | Remove (agreed with audit) |
| **Local vs Long Distance sections** | Cognitive segmentation | Remove section headers; sort by last interaction instead |
| **Friendship type labels** | Visual noise on friend cards | Hide from cards; use internally for AI mode selection |
| **Shared event interests on friend cards** | Only useful for Events (V2 feature) | Remove from friend cards |
| **4-tab notification structure** | Over-segments | Merge to single list |
| **4-tab settings structure** | Over-segments | Single page with one "Advanced" accordion |
| **Learned preferences display** | Exposes AI internals | Remove or bury behind 5+ hangout gate |
| **Apple Calendar connect** | Secondary — Google is primary | Keep in Settings but don't promote |
| **Outlook Calendar connect** | Secondary | Keep in Settings but don't promote |
| **PWA install prompt** | Timing-dependent | Show only after 3+ sessions, not immediately |
| **Invite codes / unique URLs** | Correct mechanism | Keep but simplify the UI — one "Share" button, not three (Text/Email/Copy) visible simultaneously |
| **Feedback form** | Useful for beta but competes in Settings | Move to standalone Help page or link |
| **📝 Log / 👋 Invite buttons in header** | Two competing CTAs | Remove both. "Invite" belongs on Friends page. "Log" should be a post-hangout prompt, not a persistent button. |

### REMOVE ENTIRELY

| Feature | Lines of Code | Justification |
|---------|--------------|---------------|
| Events page | 1683 lines | Different product. V2. |
| Smart Event Picks (Dashboard) | ~60 lines of render | Attentional capture away from core action |
| Saved Events (Dashboard) | ~50 lines of render | Duplicate of removed Events page |
| Groups feature | ~500 lines across files | Redundant with multi-select (agreed) |
| Dashboard calendar view | ~400 lines | User has Google Calendar already |
| Activity Feed | ~80 lines of render | Empty for new users, noise for returning |
| How It Works banner | ~60 lines | Users learn by doing |
| Score emojis (🔥👍🤔😐) | ~30 lines | Decision fatigue on scheduling |

---

## 5. The Scheduling Question

Shari asked specifically about AI scheduling UX. Three options:

### Option A: Show available times, let user pick (Simple)

The user sees a plain list of 3-5 available time slots. No scores, no rankings, no visual indicators. They pick one.

**Pros:** Lowest cognitive load. Fastest to decision. No meta-decisions about what scores mean.
**Cons:** If there are 10+ available slots, the user has to scroll and evaluate manually.

### Option B: Rank/score with visual indicators (Smart but complex)

The current implementation. Each time slot has a score emoji (🔥👍🤔😐) and the list is sorted by match quality.

**Pros:** Helps experienced users find "optimal" times. Acknowledges that not all free times are equal.
**Cons:** New users don't understand the scoring. Introduces decision fatigue ("is 72% good enough?"). The scores are meaningless until the AI has behavioral data. The 🤔 and 😐 emojis on lower-ranked slots subtly discourage selection — but those times might be genuinely fine.

### Option C: Just pick the best one — "How about Saturday 2pm?" (Opinionated)

The AI selects the single best time and presents it. User taps "Book" or "Show more times."

**Pros:** Absolute minimum cognitive load. Mimics how a friend would suggest a time. One decision, not eight. Fastest path to booking.
**Cons:** Feels controlling for some users. "What if I'd prefer a different time?" But the "Show more times" escape hatch solves this.

### My Recommendation: Option C for first-time users, Option A after that

**Day 1:** "How about Saturday at 2pm?" + "Book" button + small "Show other times" link.
This is how scheduling works in real life. Your friend doesn't send you 8 ranked time options — they suggest one time and you say yes or counter. Slotted should feel like a friend, not a spreadsheet.

**After first hangout:** Show 3-5 available times as a simple list (Option A). The user now understands the app and can make faster decisions.

**After 5+ hangouts:** Optionally introduce subtle visual ranking (color gradient on time slots, not score numbers or emojis) for users who want optimization.

**Never do:** Score emojis. Score percentages. "AI recommended" badges. These make the AI visible and introduce meta-decisions.

### Social Battery: Background Only

The social battery should NEVER be explained to a new user. It should:
1. Default to "Open" for all new users
2. Work in the background, influencing the AI's time slot selections
3. Appear in Settings as an advanced control after the user has 3+ completed hangouts
4. Never show battery status on friend cards (this is already correct — the privacy decision was right)

The battery concept requires the user to understand: (1) what it does, (2) how it affects suggestions, (3) that they should update it. That's three concepts to teach before the user has seen the app work once. Let the AI handle energy management invisibly.

---

## 6. What the Audit Missed

### 6.1 Copy and Microcopy

The audit focused on structural elements (sections, buttons, emojis) but didn't address **text length and density**. Look at the Dashboard greeting:

```tsx
<p className="mt-1 text-xs text-gray-400">{todaySummary}</p>
```

The `todaySummary` is a constructed string: "2 hangouts coming up · 14 friends · 3 people to catch up with." That's three data points in one line. For a new user with 0 hangouts, 1 friend, and 0 catch-ups, this reads: "0 hangouts coming up · 1 friend." This is sad math. It highlights what's missing.

**Recommendation:** Don't show statistics until they're worth celebrating. "0 hangouts" is not a stat — it's a guilt trip. Replace with contextual microcopy: "Ready to schedule your first hangout?" or "Invite a friend to get started."

Also: the "How It Works" banner has 5 steps, each with a paragraph of explanatory text. Nobody reads 5 paragraphs of instructions. If the app requires 5 paragraphs to explain, the app is too complicated.

### 6.2 Visual Hierarchy on Mobile

The audit noted competing elements but didn't address the mobile experience specifically. On mobile (where most users will access a PWA):

- The greeting + 2 CTA buttons (Log, Invite) take up the entire first viewport
- Below the fold: How It Works banner
- Further below: calendar/upcoming section
- Even further: People to See

The user has to SCROLL to reach the core action (find times with a friend). On mobile, above-the-fold is everything. The first thing a returning mobile user should see is either their next upcoming hangout or the "Find times" CTA.

**Recommendation:** On mobile, the header should be compact (greeting + one subtle action link). The first full-width element should be either the next upcoming hangout card or the "Find times" CTA. Everything else scrolls below.

### 6.3 The Emotional Journey

The audit was structural. It didn't address how the app FEELS.

**Current feeling for a new user:** Overwhelming. "There's a calendar, and groups, and events, and an activity feed, and a log form, and 4 settings tabs, and... what am I supposed to do?"

**Target feeling for a new user:** "Oh, this is simple. I invite a friend, it finds times, I pick one. Done."

**Current feeling for a returning user with 5+ friends:** Possibly engaging, but buried under sections they have to scroll past.

**Target feeling for a returning user:** "I open the app, I see my next hangout with Alex on Saturday, and there's a nudge that I haven't seen Jamie in 3 weeks. Let me schedule something."

The emotional arc should be:
1. **Day 1:** "This is dead simple" → confidence
2. **Week 1:** "Oh cool, my friend joined and we booked in 10 seconds" → delight
3. **Week 2+:** "The app noticed I haven't seen Jamie and suggested a time" → surprise/value
4. **Month 1+:** "I'm actually seeing my friends more" → loyalty

Every feature that appears before its moment in this arc HURTS the emotional journey. Smart Event Picks on Day 1 doesn't create delight — it creates "what is this? I don't even have friends on here yet." The Activity Feed when empty doesn't create value — it creates "the app is trying too hard."

### 6.4 Onboarding as Progressive Experience

The audit didn't deeply question the onboarding flow. It was trimmed from 8 steps to 2 (calendar connect + preferred times), but the "preferred times" step still exists.

**Challenge:** Can we get to ZERO onboarding questions?

1. **Calendar connect** is required (keep)
2. **Preferred times** can be learned from behavior

The flow becomes: OAuth → "Connect your calendar" → Dashboard. One screen of setup, not two. Preferred times get learned from which time slots the user selects in their first 2-3 scheduling interactions. This is what progressive profiling is FOR — so why are we still asking upfront?

### 6.5 The Friend Invite UX

The invite flow matters enormously because it's a two-sided marketplace problem. The app is only useful when BOTH friends are on it. The current invite mechanism (share link via Text/Email/Copy) is fine, but the invite LANDING experience for the friend matters equally.

**What happens when a friend clicks the invite link?** They land on the LoginPage with a generic two-section marketing page. They see "Local friends & family" and "Long-distance friends & family" — but they don't have context. They were texted a link by a friend. They need: "Shari invited you to find times to hang out. Sign up to see when you're both free."

The invite landing page should be personalized: inviter's name, a clear value prop ("find times that work for both of you"), and a single "Sign up with Google" button. This isn't in the audit at all.

### 6.6 The Two-Button Problem

Looking at the actual source code (DashboardPage.tsx lines 821-832), the header has two gradient-styled buttons side by side: "📝 Log" and "👋 Invite". Both are visually prominent. Both are gradient CTAs.

This is the **dual CTA anti-pattern**. When two buttons compete for attention, neither wins. The user's eye bounces between them and they choose neither.

"Log" is an action for returning users with completed hangouts. "Invite" is an action for new users building their network. These should NEVER appear together with equal visual weight. For a new user, only "Invite" should be visible. For a returning user with hangout history, only the relevant contextual action should appear.

---

## 7. The Radical Simplification Proposal

If I could redesign the Day 1 experience from scratch, it would be:

### Screen 1: Sign up + Calendar

OAuth → Connect Calendar. One screen. One action.

### Screen 2: Dashboard (0 friends)

```
Welcome to Slotted.

Invite a friend to find times to hang out.

[ Share invite link ]
```

Nothing else. The nav shows: Home, Friends, Notifications (badge only). No Settings in nav — accessible from avatar dropdown.

### Screen 3: Dashboard (1 friend, 0 hangouts)

```
Hey Shari! Alex just joined.

[ Find times with Alex → ]
```

One card. One action. The entire screen pivots to the core value.

### Screen 4: Find Times (first time)

```
How about Saturday at 2pm?

[ Book it ]     See other times →
```

One suggestion. One button. Escape hatch for control.

### Screen 5: Booked

```
You're meeting Alex Saturday at 2pm!
Added to your Google Calendar ✅

[ Back to home ]
```

Done. The user has experienced the core value in under 3 minutes.

### Progressive Unlocks (post-first hangout)

- **After 1 hangout:** Quick rating prompt ("How was hanging with Alex? ⭐⭐⭐⭐⭐")
- **After 2 friends:** Multi-select appears on Friends page
- **After 3 friends:** "People to See" row appears on Dashboard
- **After 5 hangouts:** Time slot scoring becomes visible (subtle gradients, no emojis)
- **After 2 weeks:** Social Battery appears in Settings
- **After 1 month:** Advanced preferences unlocked, Events page available

---

## 8. Summary of Disagreements with Previous Audit

| Audit Recommended | My Position | Reasoning |
|-------------------|-------------|-----------|
| Dashboard: 3 sections (Upcoming + Catch Up + CTA) | Too many for Day 1 | Empty sections are worse than no sections |
| Friends: Show all friends in flat list | Too much metadata per friend | Strip to avatar + name + last seen. Remove interest badges, sync status, cadence. |
| Events: Remove from V1 (recommended) | Non-negotiable removal | Audit was too gentle; presented it as optional |
| Notifications: Merge 3 tabs to 1 | Consider killing the page | Show actionable items as banners on relevant pages |
| Settings: 4 tabs → 2 tabs | 2 tabs → 1 page with "Advanced" accordion | Most settings are power-user; hide them |
| Emojis: 108 → 84 (first pass) | 108 → 13 was correct in strict audit | Enforce the strict audit without compromise |
| Score emojis (🔥👍🤔😐) on time slots | Remove entirely | Decision fatigue, meaningless without data |
| "How It Works" banner → /help page | Remove entirely; use single first-visit tooltip | Nobody reads help pages; apps should be self-explanatory |
| Hangout logging form | Simplify to star rating only for first interaction | 6-field form is a product inside a product |
| Calendar on Dashboard (desktop) | Remove | This is the hardest sell but the right call — Slotted isn't a calendar app |

---

## 9. Final Word

Shari's instinct is right: "more features seems better but distractions at the start can actually be a problem." The research confirms it. The code confirms it. 2034 lines in DashboardPage.tsx confirms it.

The app that gets someone from signup to "wow, that was easy" in under 3 minutes isn't the app that shows them everything it can do. It's the app that shows them one thing, does it perfectly, and reveals more only when they're ready.

The hardest part of simplification isn't knowing what to cut — the audit already identified most of it. The hardest part is accepting that a nearly-empty screen IS the product for Day 1 users. The empty Dashboard isn't a failure state — it's the starting line.

**The single most impactful change:** Make the Dashboard state-aware. Instead of showing the same 10+ sections to every user, show exactly what that user needs right now based on their stage: inviting, scheduling, or maintaining. This is the one architectural shift that solves the "too busy" problem at its root.

---

*This document is a REVIEW, not an implementation plan. The goal is to challenge assumptions and push toward a simpler product. Implementation decisions remain with Shari.*
