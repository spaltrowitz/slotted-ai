# UI Simplification — Research Findings

**Date:** 2025-07-25  
**Author:** Suki (Designer)  
**Goal:** Audit every page to identify what makes the app feel "busy" and unclear about primary actions

---

## Executive Summary

The app suffers from **decision paralysis** — too many competing elements, excessive emoji usage, and the Groups feature adding cognitive overhead without clear value over existing multi-friend selection. **297 button elements** exist across pages and navigation.

### Primary Issues Identified

1. **Emoji Overload:** 50+ unique emojis across the app, many decorative rather than functional
2. **Groups Feature:** Adds entire UI section but duplicates functionality of selecting multiple friends
3. **Too Many CTAs:** Multiple actions compete for attention on each page (avg 8-12 buttons per view)
4. **Navigation:** 4 nav items is reasonable, but "Inbox" label unclear (vs "Notifications")
5. **Unclear Primary Actions:** Users land on pages and don't know what to do first

---

## Navigation (AppShell.tsx)

**File:** `client/src/components/AppShell.tsx` (197 lines)

### Current Elements

**Desktop top nav (4 items):**
- Home (dashboard icon)
- Friends (people icon)
- Inbox (bell icon) — label says "Inbox" but route is `/notifications`
- Settings (cog icon)
- Sign out button
- User avatar (links to settings)

**Mobile bottom nav (4 items):**
- Same 4 items, icon + label

### Analysis

- **4 nav items is appropriate** for this app's scope
- **"Inbox" vs "/notifications" mismatch** — label should match mental model
- **Competing user actions in header:** Avatar (→ Settings) + Settings nav item = redundant
- **Sign out button** only on desktop — okay, low priority action
- No emojis in nav (good)

### Problems

1. **"Inbox" label doesn't match page reality** — NotificationsPage has tabs (Requests, Reminders, Activity), not unified inbox
2. **Avatar and Settings nav both go to Settings** — redundant affordance

---

## DashboardPage.tsx (2034 lines)

**Route:** `/dashboard`  
**Primary Action:** Should be "Find times with a friend" but competes with too many other options

### Current Elements (Top to Bottom)

#### Header Section
- Greeting with time emoji (☀️/🌤️/🌙)
- "📝 Log" button (top-right)
- "👋 Invite" button (top-right)
- Today summary text

#### "How It Works" collapsible (💡)
- 5-step walkthrough with numbered emojis (1️⃣-5️⃣)
- Install app CTA
- Toggles open/closed

#### Calendar Just Connected toast (✅)

#### Calendar Section (desktop only)
- "📅 My Calendar" heading
- "✏️ Busy" toggle button
- View toggles: Week/Month/Agenda
- Mark Busy mode with drag-to-select
- Calendar grid with events (shows Google 📧, Apple 🍎, Buffer 🗓️ icons)
- All-day events row
- Time grid (7am-11pm)
- Busy blocks (yellow with ✏️)

#### Mobile Upcoming Hangouts panel
- "📅 Upcoming This Week" heading
- Week breakdown (This Week/Next Week)
- Confirmed status (✓) vs pending
- Empty state with "Find a time with a friend" CTA

#### Pending Hangouts (⏳)
- Shows all pending meetups
- ✅/❌/⏳ status emojis per participant
- Expand/collapse per meetup
- Action buttons: Accept ✅ / Decline ✕ / Find new time 🔄 / Share 🔗 / Cancel ✕

#### Confirmed Hangouts (✅)
- Shows confirmed meetups
- Action buttons: 📅 Add to Calendar / Find new time 🔄 / Share 🔗 / Cancel ✕

#### Friends to See (👋)
- Avatar row (up to 12 friends)
- "Catch up with" label
- Horizontal scroll

#### Smart Event Picks (🎯)
- Up to 3 event suggestions
- "Events to do with friends" heading
- Browse all → link
- Each event: image/emoji 🎟️, title, date/venue, reason, friend avatars

#### Saved Events (❤️)
- Up to 5 saved events
- Each event: image/emoji 🎟️, title, date/venue, "🎟️ Tickets" button

#### Activity Feed (✨)
- Shows overdue friends, recent activity, free weekends
- Each item: emoji (⏰/✨/📅), friend avatar, message, timestamp, dismiss X button

#### No Hangouts CTA (when empty)
- 📅 emoji
- "No hangouts coming up"
- "Find a time with a friend" button

#### Hangout History (📝)
- Auto-detected past meetups
- Manual "Log" form with:
  - Date picker
  - Friend selector (avatars)
  - Activity selector (☕🍽️🍻🚶💪🎬🎮📞📱💻✨ — **11 emojis**)
  - Duration buttons (30min - 3+hr)
  - Time of day (🌅☀️🌆🌙 — **4 emojis**)
  - Star rating (⭐⭐⭐⭐⭐)
  - Cancel reason options (🤒❌😬😴📅🤷 — **6 emojis**)
  - Save/Cancel buttons

#### Connect Calendar CTA (when not connected)
- 📅 emoji
- "Connect Google Calendar →" button

### Emoji Inventory (DashboardPage)

| Emoji | Purpose | Functional? | Keep? |
|-------|---------|-------------|-------|
| ☀️🌤️🌙 | Time of day in greeting | Decorative | **Remove** — greeting text is enough |
| 📝 | Log button | Label redundancy | **Remove** — "Log" is clear |
| 👋 | Invite button | Label redundancy | **Remove** — "Invite" is clear |
| 💡 | How It Works | Indicates info | **Keep** — signals help content |
| 1️⃣-5️⃣ | How It Works steps | Structural | **Keep** — step numbers |
| ✅ | Success states | Functional feedback | **Keep** |
| 📅 | Calendar/dates everywhere | Overused | **Reduce** — use icons not emojis |
| ✏️ | Edit/Busy mode | Functional action | **Keep** |
| ⏳ | Pending status | Functional state | **Keep** |
| ✅❌⏳ | RSVP status | Functional state | **Keep** (but ❌ violates soft social dynamics) |
| 🔄 | Find new time | Functional action | **Keep** |
| 🔗 | Share | Functional action | **Keep** |
| ✕ | Cancel/decline | Functional action | **Keep** |
| 👋 | Catch up with (section) | Decorative | **Remove** |
| 🎯 | Smart Event Picks | Decorative | **Remove** |
| 🎟️ | Events | Decorative/fallback | **Keep as fallback** when no image |
| ❤️ | Saved Events | Functional state | **Keep** |
| ✨ | Activity Feed / Other activity | Overused, decorative | **Remove from activity, keep for "Find times" CTA** |
| ⏰📅✨ | Activity types | Functional category | **Keep** |
| ☕🍽️🍻🚶💪🎬🎮📞📱💻 | Activity log options | **10 emojis** | **Keep** — communicates activity type |
| ✨ | "Other" activity | Decorative | **Remove** — use label |
| 🌅☀️🌆🌙 | Time of day (log) | **4 emojis** | **Keep** — visual time picker |
| ⭐ | Rating | Functional | **Keep** |
| 🤒❌😬😴📅🤷 | Cancel reasons | **6 emojis** | **Keep** — softens cancellation |

**Total DashboardPage emojis: 44 unique**  
**Recommendation: Remove ~15 decorative emojis, keep 29 functional**

### Primary Action Problems

1. **"Find times with a friend" is buried** — appears as:
   - Avatar row (not labeled as primary action)
   - No-hangouts empty state CTA
   - Navigation to /friends page
2. **Calendar dominates on desktop** — takes visual priority over friend action
3. **Too many sections fight for attention:** Calendar, Pending, Confirmed, Friends, Events, Saved, Activity, History, Log form
4. **Log button in top-right competes with Invite button** — both gradient CTAs

### Competing Elements

- **Calendar vs Friends** — both "primary" on desktop
- **📝 Log vs 👋 Invite** — both top-right CTAs
- **"How It Works" banner** — takes vertical space, competes with content
- **Smart Event Picks vs Saved Events** — two event sections back-to-back
- **Activity Feed vs Hangout History** — both "past activity" concepts

---

## FriendsPage.tsx (1055 lines)

**Route:** `/friends`  
**Primary Action:** Should be "Find times with a friend" but competing with Groups and Invite

### Current Elements (Top to Bottom)

#### Header
- "Friends" title
- "Your people. See who's around and feeling social 🫶" subtitle

#### Find Times Panel (when active)
- FriendAvailability component (full-width panel)
- Or GroupAvailability component (for groups)

#### Invite Section
- Explanation text
- 📱 Text button
- 📧 Email button
- 📋 Copy link button

#### Groups Section (👥)
- "👥 Groups · {count}" heading
- "+ New group" button
- Group cards:
  - 👥 emoji per group
  - Group name + member list
  - ✨ Find times button
  - + (add member) button
  - X (delete) button
  - "Not yet connected" friend request UI (nested)
  - "Add a friend to this group" panel (nested, shows all non-member friends with + buttons)
- Empty state:
  - 👯 emoji
  - "No groups yet" message
  - Explanation text
  - "+ Create your first group" button
- Create Group form:
  - Name input
  - Member checkboxes (all friends listed with avatars)
  - Email invite input (for non-Slotted users)
  - Create Group / Cancel buttons

#### Friend Requests (Incoming)
- Shows pending invites
- Each: avatar, name, email, Accept/Decline buttons

#### Pending Invites (Outgoing)
- Shows sent invites
- Each: avatar, name, email, "Pending" badge

#### Local Friends Section (📍)
- "📍 Local · {count}" heading
- Friend cards:
  - Avatar
  - Name
  - Social battery emoji (🟢🟡🔴)
  - Email
  - 📅 Cal synced / No cal
  - Shared event interest badges (🎭🎵⚽😂🎪💃🎻)
  - ⏰📅 Hangout cadence (if 2+ logged)
  - ✨ Find times button
  - X (remove) button (desktop only)

#### Long Distance Friends Section
- Heading with + button
- Add Long Distance picker (shows local friends with + buttons)
- Friend cards (same as Local)
- Empty state: 🌎 emoji, explanation

#### Remove Friend modal (when triggered)
- Red icon
- "Remove friend?" heading
- Explanation
- Cancel / Remove buttons

#### Delete Group modal (when triggered)
- Red icon
- "Delete group?" heading
- Explanation
- Cancel / Confirm buttons

### Emoji Inventory (FriendsPage)

| Emoji | Purpose | Functional? | Keep? |
|-------|---------|-------------|-------|
| 🫶 | Subtitle decoration | Decorative | **Remove** |
| 📱📧📋 | Invite buttons | Label redundancy | **Remove** — text is clear |
| 👥 | Groups section/card | Category label | **Keep** |
| 👯 | Empty groups state | Decorative | **Remove** |
| ✨ | Find times button | Overused | **Remove** — "Find times" text is clear, use icon |
| 🟢🟡🔴 | Social battery | Functional state | **Keep** |
| 📅 | Calendar sync status | Functional state | **Keep** (but use icon) |
| 🎭🎵⚽😂🎪💃🎻 | Event interests | **7 emojis**, functional | **Keep** — visual interest matching |
| ⏰📅 | Hangout cadence | Functional info | **Keep** |
| 📍 | Local friends | Category label | **Keep** |
| 🌎 | Long distance | Category label | **Keep** |

**Total FriendsPage emojis: 20 unique**  
**Recommendation: Remove 4 decorative, keep 16 functional**

### Groups Feature Analysis

**What it does:**
- Create named groups of 3+ friends
- Find availability across entire group at once
- Save groups for reuse

**Where it appears:**
- Entire section on FriendsPage (always visible)
- Empty state, create form, group cards, management UI
- Takes significant vertical space
- GroupAvailability component (same as FriendAvailability but for multiple friends)

**Why it's redundant:**
- **FriendAvailability already supports multiple friends** — you can select 2+ friends to find group times
- **Saving groups = minor convenience** — doesn't justify the UI complexity
- **"Groups" mental model confusing** — users think it's for persistent group chats/events, not just a UI shortcut

**User feedback context (from TASK description):**
> "Groups feature isn't needed — selecting multiple friends already handles group scheduling"

### Primary Action Problems

1. **✨ Find times button on every friend** — correct, but emoji is decorative noise
2. **Groups section competes with friends list** — both are "people to schedule with"
3. **Invite section at top competes** — 3 buttons before user sees friends

### Competing Elements

- **Invite buttons (3) vs Find times buttons (N)** — both CTAs, different goals
- **Groups section vs Friends list** — both "people you can schedule with"
- **New group button vs Find times buttons** — competing "next action"
- **Local vs Long Distance sections** — segmentation adds cognitive load

---

## EventsPage.tsx (1683 lines)

**Route:** `/events`  
**Primary Action:** Discover/search events, save for later, match with friends

### Current Elements (Top to Bottom)

#### Header
- "🎯 Events to do with friends" title

#### Tab Navigation
- 🗺️ Discover
- 🔍 Search
- ❤️ Saved (with count badge)
- 📅 Calendar (view saved on calendar)

#### Discover Tab
- "How Events Work" collapsible (✨):
  - 🔍 Search step
  - 👥 Match step
  - 🎟️ Book step
- Filter pill: "📅 All / ☀️ Today / 🌅 Tomorrow"
- Category cards (6): 🎵 🎭 ⚽ 😂 🍷 🏘️
- Event cards (infinite scroll):
  - Image or 🎟️ fallback
  - Title, date/venue
  - ❤️ Save button
  - "✨ Match with friends" button

#### Search Tab
- Category filters: 🔍 All / 🎭 Theater / 🎵 Concerts / ⚽ Sports / 😂 Comedy / 🎪 Festivals / 💃 Dance / 🍷 Food & Drink / 🏘️ Community / 🌳 Outdoors
- Search input
- Date filter: 📅 All / ☀️ Today / 🌅 Tomorrow
- Event results grid (same card design as Discover)

#### Saved Tab
- Saved events list
- Same card design
- Remove ❤️ button

#### Calendar Tab
- Month view of saved events
- Event markers on dates
- Click date → see events that day

### Emoji Inventory (EventsPage)

| Emoji | Purpose | Functional? | Keep? |
|-------|---------|-------------|-------|
| 🎯 | Page title | Decorative | **Remove** |
| 🗺️🔍❤️📅 | Tab labels | **4 emojis**, decorative | **Remove** — icons would be clearer |
| ✨ | How Events Work | Decorative | **Remove** |
| 🔍👥🎟️ | How Events steps | Category icons | **Keep** |
| 📅☀️🌅 | Date filter | **3 emojis**, functional picker | **Keep** |
| 🎵🎭⚽😂🎪💃🍷🏘️🌳 | Category filters | **9 emojis**, functional categories | **Keep** |
| 🎟️ | Event fallback | Functional fallback | **Keep** |
| ✨ | Match with friends button | Decorative | **Remove** — "Match" text is clear |

**Total EventsPage emojis: 24 unique**  
**Recommendation: Remove 4 decorative, keep 20 functional**

### Primary Action Problems

1. **Four tabs compete for attention** — no clear starting point
2. **"How Events Work" banner** — same issue as Dashboard, takes space
3. **Two CTAs per event** — Save ❤️ and Match ✨ compete

### Competing Elements

- **Discover vs Search tabs** — unclear difference to new user
- **Category filters (9) vs search** — two ways to narrow, overwhelming
- **Save vs Match buttons** — both actions on every event

---

## NotificationsPage.tsx (747 lines)

**Route:** `/notifications`  
**Primary Action:** Respond to requests (RSVPs, friend requests)

### Current Elements

#### Header
- "Inbox" title (but page is at `/notifications` route)

#### Tab Navigation (3 tabs)
- Requests (actionable notifications)
- Reminders (FYI notifications)
- Activity (passive updates)

#### Requests Tab
- Friend requests:
  - 👋 emoji
  - Avatar, name, email
  - Accept / Decline buttons
- Meetup requests:
  - 📅 emoji
  - Friend avatar, meetup title, time
  - ✅ Accept / Maybe / ✕ Decline buttons
- Counter-propose requests:
  - 💡 emoji
  - Original vs proposed time
  - Accept / Keep Original buttons

#### Reminders Tab
- Meetup reminders: ⏰ emoji
- Calendar matches: ✨ emoji
- RSVP changes: 🔄 emoji
- Time changes: 🕐 emoji
- Counter-proposes: 💡 emoji
- Each: avatar, message, timestamp, "View meetup" button

#### Activity Tab
- Friend accepted: 🎉 emoji
- Meetup confirmed: ✅ emoji
- Each: avatar, message, timestamp

#### Empty States
- Requests: "You're all caught up! 🎉"
- Reminders: "No reminders right now"
- Activity: "No recent activity"

### Emoji Inventory (NotificationsPage)

| Emoji | Purpose | Functional? | Keep? |
|-------|---------|-------------|-------|
| 👋 | Friend request type | Category icon | **Keep** |
| 📅 | Meetup request type | Category icon | **Keep** |
| 💡 | Counter-propose type | Category icon | **Keep** |
| ✅ | Accept button/status | Functional action | **Keep** |
| ✕ | Decline button | Functional action | **Keep** |
| ⏰ | Reminder type | Category icon | **Keep** |
| ✨ | Calendar match type | Decorative | **Remove** |
| 🔄 | RSVP change type | Functional status | **Keep** |
| 🕐 | Time change type | Category icon | **Keep** |
| 🎉 | Friend accepted/caught up | Decorative celebration | **Keep** (positive reinforcement) |

**Total NotificationsPage emojis: 10 unique**  
**Recommendation: Remove 1, keep 9**

### Primary Action Problems

1. **Tab navigation adds friction** — user must pick a tab before seeing actionable items
2. **Three tabs segment related content** — "Requests" vs "Reminders" distinction unclear
3. **Buttons compete** — Accept/Maybe/Decline = 3 choices instead of 2

### Competing Elements

- **Requests vs Reminders tabs** — both contain meetup-related notifications
- **Accept vs Maybe buttons** — "Maybe" is soft but adds decision overhead
- **View meetup buttons** — take user away from notification flow

---

## SettingsPage.tsx (1253 lines)

**Route:** `/settings`  
**Primary Action:** Configure account, calendar, preferences

### Current Elements

#### Header
- Sticky header with "Settings" title
- Tab navigation: Profile / About You / In Person / Calls
- Save Changes button (gradient CTA)

#### Profile Tab (Numbered sections with gradient number badges)
1. **Account & Calendars (1)**
   - User avatar, name (editable), email
   - Google Calendar: status, Connect/Disconnect buttons, calendar selection (nested detail panel)
   - Apple Calendar: Connect button, form (email/password), detail panel
   - Outlook Calendar: Connect/Disconnect buttons, detail panel
   - Push notifications prompt
   - Install app prompt

2. **Social Settings (2)**
   - Display name input
   - Social battery toggle (Open 🟢 / Ask me 🟡 / Recharging 🔴)
   - "Recharging days" multi-select (days of week)
   - Share hangouts toggle

3. **Feedback (3)**
   - Textarea
   - Submit button

4. **Account Actions (4)**
   - Sign out button
   - Delete account button (red)

#### About You Tab
- Social goal (dropdown)
- Preferred duration (dropdown)
- Preferred call duration (dropdown)
- Event interests (multi-select checkboxes: 🎭🎵⚽😂🎪💃🎻)
- Event city (input)

#### In Person Tab
- Neighborhood (input)
- Work neighborhood (input)
- Office days (multi-select: Mon-Fri)
- Office varies toggle
- Travel buffer (slider: 15-60 min)
- Planning style (Flexible / Structured toggle)
- Preferred times (multi-select: Weekday morning/afternoon/evening, Weekend morning/afternoon/evening)

#### Calls Tab
- Video platforms (checkboxes: Zoom, Google Meet, FaceTime, Teams, other)
- Call windows (list + add form):
  - Day selector (multi-select: Mon-Sun)
  - Start time input
  - End time input
  - Label input
  - Add button

### Emoji Inventory (SettingsPage)

| Emoji | Purpose | Functional? | Keep? |
|-------|---------|-------------|-------|
| 🟢🟡🔴 | Social battery states | Functional toggle | **Keep** |
| 🎭🎵⚽😂🎪💃🎻 | Event interests | **7 emojis**, functional | **Keep** |

**Total SettingsPage emojis: 10 unique**  
**Recommendation: Keep all (functional state/category indicators)**

### Primary Action Problems

1. **Four tabs segment related settings** — user must hunt for specific setting
2. **Numbered sections (1-4) add visual noise** — gradient badges on every section
3. **Too many nested detail panels** — calendar selection hidden behind button, then more buttons
4. **Save button doesn't indicate unsaved changes** — no visual feedback until clicked

### Competing Elements

- **Four tabs** — unclear which settings live where
- **Multiple Connect buttons** — Google, Apple, Outlook all compete
- **Nested panels within panels** — calendar details → selected calendars list
- **Social battery vs Recharging days** — related concepts, separated
- **Feedback section** — competes with account settings

---

## OnboardingPage.tsx (250 lines)

**Route:** `/onboarding`  
**Primary Action:** Complete setup steps to start using app

### Current Elements

- Step-by-step flow (not a single page)
- Connect calendar
- Set preferences
- "Skip" options

**Note:** Onboarding is out of scope for this audit (user only sees it once).

---

## InvitePage.tsx & EventSharePage.tsx

**Routes:** `/invite/:code`, `/e/:code`  
**Purpose:** Public pages for non-users to accept invites or add shared events

**Note:** Public pages out of scope for logged-in user experience audit.

---

## Summary: Competing Elements Across App

### Dashboard Problems
- Calendar vs Friends (both "primary" on desktop)
- Log vs Invite (both top-right CTAs)
- How It Works vs content
- Smart Events vs Saved Events
- Activity Feed vs Hangout History

### Friends Problems
- Invite section vs Friends list
- Groups section vs Friends list
- Local vs Long Distance segmentation

### Events Problems
- Discover vs Search tabs
- Category filters (9) vs search
- Save vs Match buttons per event

### Notifications Problems
- Requests vs Reminders tabs
- Accept vs Maybe vs Decline (3 choices)

### Settings Problems
- Four tabs segment settings
- Multiple calendar Connect buttons
- Nested detail panels

---

## Emoji Usage Summary

| Page | Total Emojis | Functional | Decorative | Recommendation |
|------|--------------|------------|------------|----------------|
| DashboardPage | 44 | 29 | 15 | Remove 15 decorative |
| FriendsPage | 20 | 16 | 4 | Remove 4 decorative |
| EventsPage | 24 | 20 | 4 | Remove 4 decorative |
| NotificationsPage | 10 | 9 | 1 | Remove 1 decorative |
| SettingsPage | 10 | 10 | 0 | Keep all |
| **Total** | **108** | **84** | **24** | **Remove 24** |

### Functional vs Decorative Definitions

**Functional emojis:**
- State indicators (🟢🟡🔴 social battery, ✅❌⏳ RSVP status)
- Category icons (🎭🎵⚽ event types, ☕🍽️ activity types)
- Action labels that add meaning (✏️ edit, 🔄 reschedule, 💡 counter-propose)
- Time/date pickers (🌅☀️🌆🌙 time of day, 📅 date)
- Feedback (✅ success, ⭐ rating)

**Decorative emojis:**
- Redundant with text (📝 + "Log", 👋 + "Invite", ✨ + "Find times")
- Pure decoration (🫶 in subtitle, 👯 empty state, 🎯 page title)
- Time of day in greeting (☀️🌤️🌙 when text says "Good morning")

---

## Groups Feature Deep Dive

### What Exists

**FriendsPage.tsx:**
- Groups section (always visible, lines 533-695)
- "👥 Groups · {count}" heading
- "+ New group" button
- Group cards with:
  - Group name + member list
  - ✨ Find times button
  - + Add member button (opens nested panel)
  - X Delete button
  - Friend request UI for non-connected group members
- Create Group form (lines 697-786)
- Empty state with "+ Create your first group" CTA

**Components:**
- `GroupAvailability.tsx` component (same as FriendAvailability but for multiple friends)

**Backend API:**
- `POST /groups` — create group
- `DELETE /groups/:id` — delete group
- `POST /groups/:id/members` — add member
- `fetchGroups` query

### What Users See

1. **Groups section always present** — even if user has 0 groups
2. **Empty state encourages group creation** — but doesn't explain value vs multi-friend selection
3. **Group cards show member list** — visual reminder of who's in each group
4. **"Not yet connected" friend request flow** — nested UI within groups
5. **Add member panel** — nested UI showing all friends not in group

### Redundancy with Existing Features

**FriendAvailability component already supports multiple friends:**
- User can select 2+ friends from Friends page
- "Find times" opens FriendAvailability (1:1) or GroupAvailability (2+)
- Same availability grid, same booking flow

**Groups = saved selection convenience:**
- Only value is not having to re-select friends each time
- But most hangouts are ad-hoc, not recurring group events
- User must create group → name it → maintain membership

### UI Complexity Added

1. **Entire section on FriendsPage** (~160 lines of UI code)
2. **Create Group form** (name input, member checkboxes, email invites, buttons)
3. **Group management UI** (add member panel, delete confirmation)
4. **Friend request flow within groups** (when group member isn't connected)
5. **GroupAvailability component** (duplicate of FriendAvailability logic)

### User Feedback (from TASK)

> "Groups feature isn't needed — selecting multiple friends already handles group scheduling"

**Interpretation:** Groups don't provide enough value to justify the UI complexity. The small convenience of saving a selection doesn't outweigh:
- Cognitive overhead of "what's a group?" mental model
- UI clutter on FriendsPage
- Decision paralysis (do I create a group or just select friends?)

---

## Recommendations Summary

### 1. Emoji Reduction (Remove 24 decorative emojis)

**Remove from buttons/labels:**
- 📝 Log, 👋 Invite, ✨ Find times (text is clear)
- 🎯 page titles
- 🗺️🔍❤️📅 tab labels (use icons)
- ☀️🌤️🌙 in greeting (text says "Good morning")

**Keep functional emojis:**
- State indicators (🟢🟡🔴, ✅❌⏳)
- Category icons (🎭🎵⚽, ☕🍽️)
- Time/date pickers (🌅☀️🌆🌙, 📅)
- Feedback (⭐, 🎉)

### 2. Remove Groups Feature

**Delete entirely:**
- Groups section on FriendsPage
- Create Group form
- GroupAvailability component
- Group management UI
- Backend `/groups` API routes

**Reasoning:**
- Duplicates existing multi-friend selection in FriendAvailability
- Adds cognitive overhead without clear value
- ~160 lines of UI code removed
- Simplifies FriendsPage significantly

### 3. Simplify Primary Actions

**Dashboard:**
- Make "Find times with a friend" more prominent (larger CTA, above calendar)
- Collapse "How It Works" by default (show on first visit only)
- Remove or minimize Log/Invite buttons (move to menu?)

**Friends:**
- Remove Invite section from top (move to bottom or separate page)
- ✨ Find times → "Find times" (remove emoji, keep as primary CTA)

**Events:**
- Merge Discover/Search tabs (single page with filters)
- Remove "How Events Work" banner

**Notifications:**
- Rename "Inbox" to "Notifications" (match route)
- Merge Requests + Reminders tabs (single actionable tab)

### 4. Navigation Clarity

- "Inbox" → "Notifications" label
- Remove avatar link to Settings (nav item already exists)

### 5. Settings Simplification

- Reduce tabs from 4 to 2 (Profile, Preferences)
- Flatten nested calendar panels (show selected calendars inline)
- Remove numbered section badges

---

## Next Steps (NOT IMPLEMENTED — RESEARCH ONLY)

This research document will be reviewed by Shari. After feedback/annotation, a separate plan document will be created for implementation.

**Do not make code changes based on this research.**
