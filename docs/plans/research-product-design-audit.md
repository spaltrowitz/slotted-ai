# Product Design & User Research Audit

**Date:** 2025-07-25  
**Author:** Suki (Designer + User Researcher)  
**Goal:** Define how a user can experience Slotted natively in the most user-friendly way, without distractions from features they don't need to get started.

---

## Executive Summary

Slotted has a powerful core value proposition buried under feature creep. The app currently presents 15+ sections across the dashboard, 297 button elements across pages, 108 emojis, and features that duplicate each other (Groups vs. multi-friend selection). Users are landing on the app and asking "what do I do first?" instead of immediately scheduling time with a friend.

**The fix is subtractive, not additive.**

This audit recommends:
1. **Remove Groups feature entirely** — duplicates multi-friend selection
2. **Remove Dashboard calendar** — doesn't serve the core loop
3. **Reduce emojis by 24** — cut decorative noise
4. **Collapse to 3 nav items** — merge Events into Friends or remove
5. **Define clear primary actions** per page — one thing to do, everything else secondary

---

## 1. Core Value Loop

### What is Slotted's reason to exist?

**The pain:** "I want to see my friends but scheduling is a pain. We text back and forth, compare calendars, propose times that don't work, and eventually give up."

**The value:** "Slotted finds the times when my friend and I are both free, ranks them by our preferences, and lets me book with one tap."

**The aha moment:** The first time a user selects a friend, sees overlapping free slots appear, and books a hangout in under 10 seconds.

### Minimum Path to Aha Moment

1. **Sign up** (Google OAuth) — 30 seconds
2. **Connect calendar** — 30 seconds  
3. **Invite a friend** (share link) — 30 seconds
4. **Friend joins + connects calendar** — (wait)
5. **Find times together** → SEE THE VALUE — 10 seconds

**Critical insight:** Everything between steps 1-3 and step 5 is friction. The app should minimize what happens before a user can experience the core value.

**Problem:** Current onboarding + dashboard puts ~8 features between the user and their first "Find times" action.

---

## 2. Critical Path Analysis

### What MUST happen (non-negotiable for V1)

| Step | Why Required | Current State |
|------|-------------|---------------|
| Sign up (OAuth) | Identity | ✅ Working |
| Connect calendar (Google) | Core functionality needs free/busy data | ✅ Working |
| Add at least 1 friend | Can't schedule alone | ✅ Working |
| Find mutual free times | THE VALUE | ✅ Working |
| Book a hangout | Completes the action | ✅ Working |
| Auto-add to calendar | Reduces friction at peak excitement | ✅ Working |

### What CAN wait (progressive disclosure)

| Feature | When to Show | Current State |
|---------|--------------|---------------|
| Apple/Outlook calendar | Settings, after Google works | ✅ In Settings (correct) |
| Hangout logging | After first hangout happens | ⚠️ On Dashboard always (wrong) |
| Event discovery | After user has friends to invite | ⚠️ Prominent in nav (wrong) |
| Social battery settings | After user understands app | ⚠️ In onboarding (wrong) |
| Activity feed | After user has history | ⚠️ On Dashboard always (wrong) |
| Push notifications | After first value moment | ✅ Prompted at right time |
| Long-distance friend management | After local friends work | ⚠️ Full section always visible (wrong) |
| Call windows | After user needs video calls | ⚠️ Full settings tab (wrong) |

### What SHOULD BE REMOVED (doesn't serve core loop)

| Feature | Why Remove |
|---------|-----------|
| **Groups** | Duplicates multi-friend selection, adds cognitive overhead, beta feedback confirms not needed |
| **Dashboard calendar view** | Doesn't enable scheduling — user already has Google Calendar |
| **Smart Event Picks on Dashboard** | Distracts from core friend scheduling action |
| **4-tab notification structure** | Over-segments simple list of actionable items |
| **"How It Works" banners** | Takes space, users figure out by doing |
| **Decorative emojis** (24 total) | Visual noise without function |

---

## 3. Page-by-Page Recommendations

### Dashboard: What should a returning user see?

**Current problems:**
- 15+ sections competing for attention
- Calendar dominates desktop but doesn't enable action
- "Find times" is buried in avatar row
- Log/Invite buttons compete as dual CTAs
- Event picks distract from friend scheduling

**What a returning user ACTUALLY needs:**
1. **Upcoming hangouts** — what's already scheduled
2. **Action prompt** — "Find times with a friend" if nothing upcoming
3. **Friends to reconnect with** — gentle nudge, not another section

**Recommended Dashboard (stripped down):**

```
┌─────────────────────────────────────────────────────┐
│  Good morning, Shari                                │
│  You have 2 hangouts this week                      │
├─────────────────────────────────────────────────────┤
│  📅 Upcoming                                        │
│  ┌──────────────────────────────────────────┐      │
│  │ Coffee with Alex      Tomorrow 10am      │      │
│  │ Dinner with the group  Saturday 7pm      │      │
│  └──────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────┤
│  👋 Time to catch up?                              │
│  [Avatar] [Avatar] [Avatar]                        │
│  Tap a friend to find times                        │
├─────────────────────────────────────────────────────┤
│  [ Find times with a friend ]  ← PRIMARY CTA      │
└─────────────────────────────────────────────────────┘
```

**What to remove from Dashboard:**
- ❌ Calendar view (Google Calendar already shows this)
- ❌ "How It Works" banner (show once on first visit only)
- ❌ Smart Event Picks (move to separate Events page if kept)
- ❌ Saved Events section (duplicate of Events page)
- ❌ Activity Feed (merge into Notifications)
- ❌ Hangout History log form (move to Settings or post-hangout prompt)
- ❌ Dual Log/Invite CTAs at top (move to menu or bottom)
- ❌ Pending section separate from Confirmed (merge into single Upcoming list)

**What stays:**
- ✅ Greeting line with summary stats
- ✅ Upcoming hangouts (pending + confirmed, merged)
- ✅ "Catch up with" friend avatars
- ✅ Primary CTA: "Find times with a friend"

### Friends Page: The most important page

**Current problems:**
- Invite section competes with friend list
- Groups section adds ~160 lines of UI for minimal value
- Local vs. Long Distance segmentation adds cognitive load
- Every friend card has decorative emojis

**What the user needs:**
1. **List of friends** — who can I schedule with?
2. **Primary action per friend** — "Find times" button
3. **Way to invite new friends** — but not front-and-center

**Recommended Friends Page (stripped down):**

```
┌─────────────────────────────────────────────────────┐
│  Friends                                           │
├─────────────────────────────────────────────────────┤
│  🔍 Search friends...                              │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐      │
│  │ [Avatar] Alex Chen                      │      │
│  │          📅 Calendar connected          │      │
│  │                        [ Find times ]   │      │
│  └─────────────────────────────────────────┘      │
│  ┌─────────────────────────────────────────┐      │
│  │ [Avatar] Jamie Wong                     │      │
│  │          Last seen: 3 weeks ago         │      │
│  │                        [ Find times ]   │      │
│  └─────────────────────────────────────────┘      │
│  ... more friends ...                              │
├─────────────────────────────────────────────────────┤
│  [ + Invite a friend ]  ← Secondary, at bottom    │
└─────────────────────────────────────────────────────┘
```

**Multi-friend selection flow (replaces Groups):**
- Tap checkbox on multiple friends → floating bar appears: "Find times for 3 friends"
- Tap → opens multi-friend availability (same component, renamed)
- No saved groups, no group management UI, no cognitive overhead

**What to remove from Friends Page:**
- ❌ Groups section entirely (duplicates multi-friend selection)
- ❌ Create Group form
- ❌ Group management UI (add member, delete)
- ❌ Local vs. Long Distance section headers (show all friends together, sort by last interaction)
- ❌ Invite section at top (move to bottom)
- ❌ Decorative emojis (🫶 in subtitle, ✨ on Find times button)

**What stays:**
- ✅ Friend list with "Find times" per friend
- ✅ Multi-friend checkbox selection
- ✅ Search/filter
- ✅ Invite link (but at bottom, not top)
- ✅ Pending friend requests (collapsed or badge)

### Events Page: Does it belong in V1?

**Honest assessment:** Events is a "nice to have" that distracts from the core value loop. Beta feedback (Emma) specifically mentioned that the value is in **group coordination**, not event discovery.

**Options:**

**Option A: Remove Events from V1 (Recommended)**
- Core value is finding times with friends, not browsing events
- Events adds cognitive overhead (4 tabs, 9 category filters)
- Users can discover events through other apps (Eventbrite, SeatGeek)
- If a friend shares an event → handle in Notifications, not separate page

**Option B: Demote Events to secondary feature**
- Remove from main nav
- Accessible only via "Looking for something to do?" link on Friends page
- Remove Saved/Calendar tabs (just search + share)

**Recommendation:** Option A for V1 simplicity. Re-add in V2 with tighter integration to friend scheduling.

### Notifications/Inbox: Simplifying 3 tabs

**Current structure:**
1. Requests (friend requests, meetup requests)
2. Reminders (meetup reminders, calendar matches)
3. Activity (friend accepted, meetup confirmed)

**Problem:** User must choose a tab before seeing actionable items. "Reminders" vs. "Requests" distinction is unclear.

**Recommended: Single unified list**

```
┌─────────────────────────────────────────────────────┐
│  Notifications                                     │
│  Mark all read                                     │
├─────────────────────────────────────────────────────┤
│  ● Alex wants to hang — Saturday 2pm               │
│    [Accept] [Maybe] [Not this time]               │
│                                                    │
│  ● Jamie accepted your friend request              │
│    10 min ago                                      │
│                                                    │
│  ● Reminder: Coffee with Sam tomorrow              │
│    1 hour ago                                      │
│                                                    │
│  ○ Your hangout with Alex was confirmed            │
│    Yesterday                                       │
└─────────────────────────────────────────────────────┘
```

**What changes:**
- Merge all 3 tabs into one list
- Sort by: Actionable first (pending RSVPs, friend requests), then chronological
- Unread indicator (●) vs read (○)
- "Inbox" label → "Notifications" (match route)

### Settings: 4 tabs is too many

**Current tabs:**
1. Profile (account, calendars, social settings, feedback)
2. About You (social goal, duration, event interests)
3. In Person (neighborhood, office, travel buffer, preferred times)
4. Calls (video platforms, call windows)

**Problem:** User hunting for specific setting doesn't know which tab. Settings are over-segmented.

**Recommended: 2 tabs**

1. **Account** — calendar connections, display name, push notifications, sign out, delete
2. **Preferences** — everything else, in logical groups:
   - Scheduling (preferred times, travel buffer, planning style)
   - Social (social goal, recharging days)
   - Long-distance (call windows, video platforms)
   - Events (interests, city)

**Additional simplifications:**
- Remove numbered section badges (1️⃣, 2️⃣, etc.)
- Flatten nested calendar panels (show connected calendars inline)
- Move feedback form to separate "Help & Feedback" section or modal

---

## 4. Calendar Removal Analysis

### What does the Dashboard calendar actually DO?

**Current functionality:**
- Shows a month/week/agenda view of the user's calendar
- Displays Google Calendar events (synced)
- Allows "Mark Busy" to manually block time
- Shows upcoming hangouts on the calendar

### Can the user get the same value without it?

**Analysis:**

| Calendar Function | Alternative |
|-------------------|-------------|
| See my schedule | User already uses Google Calendar app |
| See upcoming hangouts | "Upcoming" section on Dashboard |
| Mark time as busy | Can do in Google Calendar directly |
| Visual overview | Not needed for scheduling with friends |

**The calendar doesn't enable the core action.** It's a view of data the user already has in their primary calendar app. Slotted's value isn't being a calendar — it's being a **scheduling assistant**.

### What replaces it?

**Nothing needs to replace it.** The space freed up should make the primary action (Find times with a friend) more prominent.

If users need to mark time as busy for Slotted specifically:
- Add a small "Block time" button in Settings → Preferences
- Or integrate with "Manual availability" that already exists

**Recommendation:** Remove the Dashboard calendar view entirely. It adds ~400 lines of code, significant visual weight, and doesn't serve the core loop.

---

## 5. Groups Removal Confirmation

### Technical scope (from Toph's research)

- **Frontend:** ~160 lines of Groups UI on FriendsPage, GroupAvailability component, queries, state
- **Backend:** 5 API endpoints (CRUD + members), database tables (`friend_groups`, `friend_group_members`)
- **Notifications:** 4 notification types for group membership changes

### UX confirmation: Why removal is right

1. **Duplicates existing functionality**
   - Multi-friend selection already works without groups
   - User selects 2+ friends → "Find times" opens multi-friend availability
   - Same result, zero overhead

2. **Unclear mental model**
   - "What's a group?" — is it for recurring hangs? A friend category? A chat?
   - Users don't need to understand groups to schedule with multiple friends

3. **Decision paralysis**
   - "Should I create a group or just select friends?"
   - Adding a feature to "save selections" isn't worth the cognitive cost

4. **Beta feedback confirms**
   - "Groups feature isn't needed — selecting multiple friends already handles group scheduling"

5. **UI simplification**
   - Removes entire section from FriendsPage
   - Removes create/edit/delete modals
   - Removes nested "add member" and "friend request" flows

**Recommendation:** Proceed with full Groups removal per Toph's research plan. Rename `GroupAvailability` to `MultiFriendAvailability` and keep the multi-friend scheduling functionality.

---

## 6. Feature Tiers

### Tier 1: Core (Must exist for app to work, Day 1)

| Feature | Page | Rationale |
|---------|------|-----------|
| Google OAuth login | Auth | Identity required |
| Google Calendar sync | Onboarding + Settings | Free/busy data is the product |
| Friend list | Friends | Can't schedule without friends |
| Invite friend (share link) | Friends | Network growth |
| Accept/decline friend request | Notifications | Complete the connection |
| 1:1 availability matching | Friends → FriendAvailability | THE CORE VALUE |
| Multi-friend availability | Friends → MultiFriendAvailability | Group scheduling without groups |
| Book a hangout | Availability panels | Complete the action |
| Auto-add to calendar | Backend | Reduce friction at excitement |
| RSVP to meetup invite | Notifications | Respond to friends |
| Upcoming hangouts view | Dashboard | See what's scheduled |

### Tier 2: Enhance (Makes app better, can be progressively disclosed)

| Feature | Current Location | When to Show |
|---------|------------------|--------------|
| Apple/Outlook calendar | Settings | After Google calendar works |
| Social battery settings | Settings | After user understands core value |
| Preferred times | Settings | After first hangout scheduled |
| Travel buffer | Settings | Power users only |
| Recharging days | Settings | Power users only |
| Hangout logging | Post-hangout prompt | After hangout happens |
| Push notifications | Permission prompt | After first value moment |
| PWA install | Prompt | After 3+ sessions |
| "Catch up with" suggestions | Dashboard | After 2+ friends connected |
| Counter-propose flow | Notifications | When declining a time |
| Long-distance friend features | Friends/Settings | After user adds long-distance friend |
| Event interests matching | Friends | After both friends set interests |

### Tier 3: Remove (Doesn't serve core loop, cut from V1)

| Feature | Current Location | Why Remove |
|---------|------------------|-----------|
| **Groups (saved collections)** | Friends | Duplicates multi-friend selection |
| **Dashboard calendar view** | Dashboard | User has Google Calendar already |
| **Events page (Discover/Search)** | Nav/Events | Distracts from friend scheduling |
| **Smart Event Picks** | Dashboard | Distracts from primary CTA |
| **Saved Events section** | Dashboard | Duplicate of Events page |
| **Activity Feed** | Dashboard | Merge into Notifications |
| **Hangout History log form** | Dashboard | Move to post-hangout prompt |
| **"How It Works" banners** | Dashboard/Events | Users learn by doing |
| **4-tab notification structure** | Notifications | Over-segments simple list |
| **4-tab settings structure** | Settings | 2 tabs is enough |
| **Decorative emojis (24)** | Throughout | Visual noise |

---

## 7. Emoji Policy

### When emojis ARE appropriate

**State indicators:**
- 🟢🟡🔴 Social battery (Open / Ask me / Recharging)
- ✅ Confirmed, ⏳ Pending, accepted
- ⭐⭐⭐⭐⭐ Ratings

**Category icons (mutually exclusive sets):**
- Activity types: ☕🍽️🍻🚶💪🎬🎮📞 (hangout logging)
- Event categories: 🎭🎵⚽😂🎪💃🎻 (event interests)
- Time of day: 🌅☀️🌆🌙 (visual time picker)

**Action labels that add unique meaning:**
- 💡 Counter-propose (distinguishes from regular suggestion)
- 🔄 Reschedule (distinguishes from new booking)

**Feedback/celebration:**
- 🎉 Friend accepted (positive reinforcement)
- ✅ Success states

### When emojis are NOT appropriate

**Redundant with text labels:**
- ❌ 📝 Log (text says "Log")
- ❌ 👋 Invite (text says "Invite")
- ❌ ✨ Find times (text says "Find times")
- ❌ 🎯 Events (text says "Events")

**Pure decoration:**
- ❌ 🫶 in "Your people. See who's around and feeling social 🫶"
- ❌ 👯 in empty states
- ❌ ☀️🌤️🌙 in greeting when text says "Good morning"

**Tab/navigation labels:**
- ❌ 🗺️ Discover, 🔍 Search, ❤️ Saved (use icons or text only)

### Policy summary

> **Use emojis only when they communicate state, category membership, or positive feedback that text alone cannot convey as effectively. Remove emojis that duplicate adjacent text labels.**

**Target:** Reduce from 108 → 84 emojis (remove 24 decorative).

---

## 8. Information Architecture

### Current navigation (4 items)

1. Home (Dashboard)
2. Friends
3. Inbox (Notifications)
4. Settings

### Recommended navigation (3 items)

1. **Home** → Simplified Dashboard
2. **Friends** → Friend list + scheduling
3. **Notifications** → Unified notification list

**Settings:** Move to user avatar dropdown or "..." menu. Settings is not a daily action — most users configure once and forget.

### Events: Where does it go?

**If Events is kept in V1 (not recommended):**
- Accessible from Friends page: "Looking for something to do together?"
- Or via "+" button on Dashboard that offers "Find times" / "Browse events"

**If Events is cut from V1 (recommended):**
- Shared event links still work (EventSharePage)
- Event notifications appear in Notifications
- Full Events page returns in V2

### Page merges

| Current | Recommended | Why |
|---------|-------------|-----|
| Dashboard + Events | Dashboard only | Events distracts from core |
| Friends + Groups | Friends only | Groups removed |
| Notifications (3 tabs) | Notifications (1 list) | Over-segmented |
| Settings (4 tabs) | Settings (2 tabs) | Over-segmented |

---

## 9. Summary: What Changes

### Remove entirely
- [ ] Groups feature (UI + backend + database)
- [ ] Dashboard calendar view
- [ ] Events page (defer to V2)
- [ ] "How It Works" banners
- [ ] 24 decorative emojis

### Simplify
- [ ] Dashboard: 15 sections → 3 (Upcoming, Catch up, CTA)
- [ ] Friends: Remove Groups section, move Invite to bottom
- [ ] Notifications: 3 tabs → 1 unified list
- [ ] Settings: 4 tabs → 2 tabs
- [ ] Nav: 4 items → 3 (move Settings to menu)

### Rename
- [ ] "Inbox" → "Notifications"
- [ ] `GroupAvailability` → `MultiFriendAvailability`

### Preserve (working well)
- Calendar sync (Google/Apple/Outlook)
- 1:1 and multi-friend availability matching
- RSVP flow with soft language
- Auto-add to calendar on acceptance
- Push notification system
- PWA install prompt

---

## 10. Answering the Beta Feedback

### Tamer: "Show me why before you ask me what"
**Addressed by:** Removing "How It Works" banners, simplifying dashboard to show value immediately. User sees upcoming hangouts and "Find times" CTA within first screen.

### Darren: "Let me tell you who I am"
**Addressed by:** Keeping preferences in Settings but making them Tier 2 (progressive). Core app works without social goal, duration preferences, etc. These enhance but don't gate.

### Emma: "My calendar is a mess"
**Addressed by:** Multi-friend scheduling (her stated interest) remains core. Manual availability already exists for non-calendar users. Dashboard calendar removal actually helps — Emma doesn't need to see a calendar view she won't maintain.

### Tom: "Parent/playdate use case"
**Addressed by:** Multi-friend scheduling is the feature for this. No Groups needed — parents select 2-4 friends and find times. Couple Mode remains in V2 backlog for family-as-unit scheduling.

---

## 11. Design Principles Compliance Check

| Principle | Current State | After Changes |
|-----------|---------------|---------------|
| Privacy-first | ✅ Battery/calendar hidden from friends | ✅ No change needed |
| Soft social dynamics | ✅ "Not this time" not "Decline" | ✅ Confirmed throughout |
| AI is invisible | ⚠️ Some "AI-suggested" language | ✅ Remove any "AI recommended" badges |
| Reduce friction at excitement | ✅ Auto-add to calendar | ✅ Simpler dashboard makes action clearer |
| No social pressure | ✅ No free slot counts shown | ✅ Confirmed throughout |

---

## 12. Success Metrics (Post-Simplification)

### What to measure

| Metric | Target | Why |
|--------|--------|-----|
| Time from signup to first "Find times" | < 2 minutes | Core value should be fast |
| % users who schedule 1+ hangout in first week | 40% (up from 30%) | Simpler path to value |
| Return rate at 7 days | 50% (up from 40%) | Less overwhelm = more return |
| Task completion: "Find times with friend" | 90% success | Clear primary action |
| Cognitive load score (user survey) | "Easy" rating from 70%+ | Reduced decision points |

---

*This document is RESEARCH/ANALYSIS only. Implementation plans will be created separately after review.*

---

## Revised Emoji Policy (Strict)

**Date:** 2025-07-25  
**Author:** Suki (Designer)  
**Trigger:** Shari feedback — 84 "functional" emojis is still way too many. Default must flip: **text/icons first, emojis must earn their place.**

### The Test

An emoji earns its place ONLY if ALL four criteria pass:
1. It communicates something text alone cannot convey as quickly (pure visual shorthand)
2. It's not redundant with an adjacent text label
3. It's not one of many in a set where text labels would work just as well
4. Removing it would genuinely make the UI harder to understand

### Full Inventory (100 unique emojis, ~678 instances)

---

### KEEP — Truly Irreplaceable (13 emojis)

These pass all four criteria. They are universal visual shorthand that text cannot replace as efficiently.

| Emoji | Where | Why It Earns Its Place |
|-------|-------|----------------------|
| 🟢🟡🔴 | SocialBattery, FriendsPage | Universal traffic-light status. Color dots ARE the UI — "green/yellow/red" text would be worse. These are state indicators, not decoration. |
| ✅ | Notification actions, confirmations | Universal "done/success" checkmark. Used as action feedback ("Accepted"), not decoration. |
| ⏳ | Pending states | Universal "waiting" indicator. Compact where "pending" text would clutter inline displays. |
| ✓ | Inline confirmations ("Sent ✓") | Minimal success indicator inside buttons. Not an emoji per se — a symbol. |
| ✕ | Close/dismiss buttons | Standard close affordance. Not an emoji — a symbol. |
| ⭐ | Star rating | Universal rating shorthand. One of the most recognized UI symbols. |
| ⚠️ | Calendar not synced warning | Universal warning triangle. Text "Warning:" is wordier in a compact badge. |
| ❤️ | Saved/favorited events | Universal "liked/saved" indicator. Standard across all apps. |

**Total: 13 unique emojis (~45 instances)**

---

### REPLACE WITH TEXT — Functional But Text Works Better (72 emojis)

These were classified as "functional" but fail criteria 2 or 3 — either redundant with adjacent text or part of a set where text labels are equally (or more) clear.

#### Activity Type Picker (11 emojis → text buttons)

| Current | Replace With | Reason |
|---------|-------------|--------|
| ☕ Coffee | "Coffee" text button | Label already says "Coffee" — emoji is redundant |
| 🍽️ Meal | "Meal" | Same |
| 🍻 Drinks | "Drinks" | Same |
| 🚶 Walk | "Walk" | Same |
| 💪 Workout | "Workout" | Same |
| 🎬 Movie | "Movie" | Same |
| 🎮 Game Night | "Game Night" | Same |
| 📞 Phone Call | "Phone Call" | Same |
| 📱 FaceTime | "FaceTime" | Same |
| 💻 Video Call | "Video Call" | Same |
| ✨ Other | "Other" | Same |

**Verdict:** 11 buttons, each with emoji + text label. The text label is what users read. Remove emojis, keep text. Cleaner, more scannable.

#### Time-of-Day Picker (4 emojis → text pills)

| Current | Replace With | Reason |
|---------|-------------|--------|
| 🌅 Morning | "Morning" | Text is unambiguous; emoji adds nothing |
| ☀️ Afternoon | "Afternoon" | Same |
| 🌆 Evening | "Evening" | Same |
| 🌙 Night | "Night" | Same |

**Verdict:** "Morning / Afternoon / Evening / Night" text pills are perfectly clear. These appear in DashboardPage, EventsPage, and SettingsPage (×3 sets).

#### Cancel Reason Picker (6 emojis → text pills)

| Current | Replace With | Reason |
|---------|-------------|--------|
| 🤒 Sick | "Sick" | Text is clearer |
| ❌ Cancelled | "Cancelled" | Text is clearer |
| 😬 Something came up | "Something came up" | Text is clearer |
| 😴 Too tired | "Too tired" | Text is clearer |
| 📅 Scheduling conflict | "Scheduling conflict" | Text is clearer |
| 🤷 Other | "Other" | Text is clearer |

**Verdict:** Users selecting a cancel reason are not browsing — they're making a choice. Text labels are faster to scan than emoji+text pairs.

#### Event Category Filters (10 emojis → text pills)

| Current | Replace With | Reason |
|---------|-------------|--------|
| 🔍 All | "All" | Magnifying glass doesn't mean "all" |
| 🎭 Theater | "Theater" | Text label is primary, emoji is decoration |
| 🎵 Concerts | "Concerts" | Same |
| ⚽ Sports | "Sports" | Same |
| 😂 Comedy | "Comedy" | Same |
| 🎪 Festivals | "Festivals" | Same |
| 💃 Dance | "Dance" | Same |
| 🍷 Food & Drink | "Food & Drink" | Same |
| 🏘️ Community | "Community" | Same |
| 🌳 Outdoors | "Outdoors" | Same |

**Verdict:** Category filter pills with just text are used successfully by Google Maps, Yelp, Airbnb, Eventbrite. Text is more scannable than emoji+text pairs at small sizes. These appear in EventsPage, FriendsPage interest tags, and SettingsPage preferences (×3 sets = ~30 instances).

#### Event Interest Tags (7 emojis → text tags)

| Current | Replace With | Reason |
|---------|-------------|--------|
| 🎭 Theater | "Theater" tag | Same as above |
| 🎵 Concerts | "Concerts" tag | Same |
| ⚽ Sports | "Sports" tag | Same |
| 😂 Comedy | "Comedy" tag | Same |
| 🎪 Festivals | "Festivals" tag | Same |
| 💃 Dance | "Dance" tag | Same |
| 🎻 Classical | "Classical" tag | Same |

**Verdict:** Overlaps with category filters above. Replace everywhere consistently.

#### Score Emojis (4 emojis → colored score badges)

| Current | Replace With | Reason |
|---------|-------------|--------|
| 🔥 (score ≥ 80) | Colored badge with score number (already exists) | Score badge + number already communicates quality. Emoji is redundant |
| 👍 (score ≥ 65) | Same | Same |
| 🤔 (score ≥ 50) | Same | Same |
| 😐 (score < 50) | Same | Same |

**Verdict:** `scoreEmoji()` function in GroupAvailability and FriendAvailability displays these NEXT TO a colored score badge that already shows the number. The badge alone communicates quality. Remove the emoji column entirely.

#### Hangout Mode Toggle (3 emojis → text with icons)

| Current | Replace With | Reason |
|---------|-------------|--------|
| 🤝 In person | "In person" (or small SVG icon) | Label is the primary affordance |
| 📞 Phone call | "Phone call" | Same |
| 💻 Video call | "Video call" | Same |

**Verdict:** Three-button toggle. Text labels are what users read. Can optionally use small SVG icons (like AppShell nav does) for visual weight.

#### Video Platform Picker (6 emojis → text pills)

| Current | Replace With | Reason |
|---------|-------------|--------|
| 📱 FaceTime | "FaceTime" | Brand name is the identifier, not emoji |
| 📹 Zoom | "Zoom" | Same |
| 🌐 Google Meet | "Google Meet" | Same |
| 💼 Teams | "Teams" | Same |
| 💬 WhatsApp | "WhatsApp" | Same |
| 📞 Google Meet (Duo) | "Duo" | Same |

#### Notification Type Icons (10 emojis → colored dot + text)

| Current | Replace With | Reason |
|---------|-------------|--------|
| 🎉 friend_accepted | Colored dot (emerald) + text | Notification text already says what happened |
| 👋 friend_request | Colored dot (violet) + text | Same |
| 📅 meetup_request | Colored dot (amber) + text | Same |
| ✨ calendar_match | Colored dot (amber) + text | Same |
| 🎟️ event_shared | Colored dot (purple) + text | Same |
| 🔄 meetup_rsvp_changed | Colored dot (sky) + text | Same |
| 🕐 meetup_time_changed | Colored dot (indigo) + text | Same |
| 💡 meetup_counter_propose | Colored dot (violet) + text | Same |
| ⏰ meetup_reminder | Colored dot (blue) + text | Same |
| 🔔 empty state | SVG bell icon | Same |

**Verdict:** Each notification already has a colored background band (bg-emerald-50, bg-violet-50, etc.) which provides category distinction. The emoji is a third redundant signal (color + text + emoji). Use just color dot + text.

#### Social Goal / Preferences Emojis (Settings, ~15 emojis)

| Current | Replace With | Reason |
|---------|-------------|--------|
| ⚡ Spontaneous | "Spontaneous" pill | Text is the label |
| 🔄 Flexible | "Flexible" pill | Same |
| 📋 Planner | "Planner" pill | Same |
| 🥳 Every day | "Every day" pill | Same |
| 😊 2–3/week | "2–3/week" pill | Same |
| 🧘 ~1/week | "~1/week" pill | Same |
| 🏡 1–2/month | "1–2/month" pill | Same |
| 📈 More | "More" pill | Same |
| ⚖️ Same | "Same" pill | Same |
| 📉 Less | "Less" pill | Same |
| ⚡ 30–60 min | "30–60 min" pill | Same |
| ☕ 1–2 hrs | "1–2 hrs" pill | Same |
| 🍽️ 2–4 hrs | "2–4 hrs" pill | Same |
| 🎉 4+ hrs | "4+ hrs" pill | Same |
| 💬/📱/📞/🙅 call durations | Text pills | Same |

**Verdict:** Settings preference pickers show emoji + text for every option. Text alone works — users are making deliberate selections, not browsing.

#### Quick Block Templates (6 emojis → text)

| Current | Replace With | Reason |
|---------|-------------|--------|
| 🥪 Weekday lunch | "Weekday lunch" | Text is clear |
| 🚗 Morning commute | "Morning commute" | Same |
| 🚙 Evening commute | "Evening commute" | Same |
| 🌆 Weekday evening | "Weekday evening" | Same |
| ☀️ Weekend morning | "Weekend morning" | Same |
| 🌙 Weekend evening | "Weekend evening" | Same |

#### Miscellaneous Redundant (scattered)

| Current | Replace With | Reason |
|---------|-------------|--------|
| 📝 Log (button text) | "Log" | Text says "Log" — emoji is redundant |
| 👋 Invite (button text) | "Invite" | Same |
| ✨ Find times (button text) | "Find times" | Same |
| 👥 Group Availability (header) | "Group Availability" | Header text is the label |
| ✨ AI Suggestions (header) | "AI Suggestions" | Same |
| 📩 Request Sent (confirmation icon) | Green checkmark SVG | SVG icon is cleaner than emoji for confirmations |
| 👀 "Track this on Dashboard" | Remove entirely | Decorative |
| 🔄 Refresh (button) | "Refresh" or SVG refresh icon | Text/icon is standard |
| 📅 Calendar icon on friend cards | "Cal synced" text or small dot | Text is equally clear |
| 📍 Location labels | "Local" / venue name text | Text "📍 Local" → just "Local" |
| 🌎 Long-distance label | "Long distance" text | Same |
| 🗺️ Discover events | "Discover" text | Same |
| 📲 Install app | "Install:" text | Same |
| 🔍 Search/Browse | "Search" / "Browse" text | Same |
| 🎯 Smart picks | "Smart picks" text | Same |
| 🎫 Tickets | "Tickets" text | Same |
| 🎤 Performer search result | Search result type text | Same |
| 💡 How It Works / tips | SVG info icon or remove | Same |
| 📧 Email invite | "Email" text | Same |
| 📱 Text invite | "Text" text | Same |
| 📋 Copy link | "Copy link" text | Same |
| 🔗 Link shared indicator | Text | Same |
| 🫶 Tagline decoration | Remove | Decorative |
| 👯 Empty states | Remove or SVG illustration | Decorative |
| 🤝 Empty state (FriendsPage) | Remove or SVG | Decorative |
| 🎭 Empty state (EventsPage) | Remove or SVG | Decorative |
| 🤷 Empty state (EventsPage) | Remove or SVG | Decorative |
| 💚💛🔴 in SocialBattery config | Not rendered (dot used instead) | Config values, not displayed. Can remove. |

---

### REMOVE — Decorative / Redundant (15 emojis, overlaps with above)

These were already identified as decorative in the original audit. Confirming removal:

| Emoji | Location | Status |
|-------|----------|--------|
| 🫶 | FriendsPage tagline | Decorative flourish |
| 👯 | FriendsPage/EventsPage empty states | Decorative |
| 🤝 | FriendsPage empty state | Decorative |
| 🥐 | SettingsPage weekend morning label | Whimsical, adds nothing |
| 🥳😊🧘🏡 | SettingsPage social frequency | Personality emojis, text label is primary |
| 📭 | DashboardPage empty mailbox | Decorative |
| 🍎 | DashboardPage apple icon | Decorative |
| 1️⃣2️⃣3️⃣4️⃣5️⃣ | HowItWorks steps | Use numbered circles (already have styled spans elsewhere) |
| 🔴 in "selected" state | SettingsPage toggle | Confusing — use filled dot styling instead |

---

### Summary

| Category | Count | Instances |
|----------|-------|-----------|
| **KEEP** | 13 | ~45 |
| **REPLACE WITH TEXT** | 72 | ~590 |
| **REMOVE** | 15 | ~43 |
| **TOTAL BEFORE** | 100 | ~678 |
| **TOTAL AFTER** | **13** | **~45** |

**Reduction: 100 → 13 unique emojis (87% reduction), ~678 → ~45 instances (93% reduction).**

This gets us well under the 20-emoji target while keeping only the truly universal visual shorthand: traffic-light status dots, checkmarks, warning triangle, star rating, and heart favorite.

---

## How It Works Relocation

### Current State

Two "How It Works" sections exist:

**1. Dashboard Banner (`DashboardPage.tsx` L90–143)**
- Collapsible accordion with 💡 icon
- 5 steps: Invite → Connect calendars → Find times → Book it → Add to calendar
- Also includes PWA install nudge when not in standalone mode
- Positioned immediately after the greeting, before any actionable content

**2. Events Page Inline (`EventsPage.tsx` L1340–1356)**
- Static 3-column grid inside the "search" tab
- 3 steps: Search → Match → Book
- Positioned at the bottom of the search interface
- Uses emoji icons (🔍👥🎟️) with descriptions

### Problem

- Dashboard banner is the first thing users see after the greeting — takes premium screen space before the core "Find times" CTA
- Events page version is buried but adds clutter to the search tab
- Both are "read once" content that clutters "use daily" screens
- Beta tester Tamer specifically said: "Show me why before you ask me what" — banners are asking "what" (how to use the app) before showing "why" (value)

### Recommendation: `/help` Page

Create a dedicated `/help` page accessible from:
1. **Settings page** — "Help & How It Works" link in the account section
2. **"?" floating icon** — small, unobtrusive help button in the header (desktop) or footer area
3. **First-visit only** — show a one-time dismissible tooltip pointing to the help link on first login

**Content for the help page:**

1. **How Slotted.ai Works** (the 5 Dashboard steps, cleaned up)
2. **Finding Events** (the 3 Events steps)
3. **Install as App** (the PWA install instructions, currently duplicated in Settings and Dashboard)
4. **FAQ** (common questions from beta feedback)

**Benefits:**
- Dashboard becomes 100% actionable — users see friends and upcoming hangouts immediately
- Events page search tab is cleaner
- Help content is still findable but doesn't compete with primary actions
- One canonical location for all onboarding/explainer content
- Can be expanded over time (FAQ, tips, etc.) without cluttering core screens

**Implementation notes:**
- Route: `/help` (no auth required — can serve as public documentation too)
- Link from Settings: "Help & How It Works" in account section
- Remove Dashboard `<HowItWorks />` component call
- Remove Events page inline "How it works" grid
- Consider a subtle "New? See how it works →" link on Dashboard that auto-dismisses after first visit (localStorage flag)

---

*Updated 2025-07-25 with strict emoji policy and How It Works relocation recommendation.*
