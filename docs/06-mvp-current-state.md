# Slotted MVP — Current State vs. Original Plan

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Last Updated** | February 13, 2026 |
| **Status** | In Development |
| **Based On** | [03-prd-mvp-v1.md](03-prd-mvp-v1.md) (original), updated through iterative design sessions |

---

## Purpose

This document captures the **actual MVP** as it exists in code, including all design decisions made during development that diverge from the original PRD. Use this as the ground truth for what the app does today.

---

## 1. What Changed & Why

### 1.1 Tech Stack Changes

| Area | Original Plan | Current State | Why |
|---|---|---|---|
| **Backend** | Node.js/Express on Railway | Firebase Functions (Node.js) | Faster deploy, integrated auth |
| **Database** | PostgreSQL on Railway | Supabase (PostgreSQL) | Managed Postgres with built-in auth helpers |
| **Frontend** | React on Vercel | React + Vite, hosted via Firebase Hosting | Single platform for hosting + functions |
| **Auth** | Custom JWT / Auth0 | Firebase Auth (Google OAuth) | Simpler integration with Firebase Functions |
| **Styling** | Tailwind CSS | TailwindCSS v4 with custom `slotted` design tokens | Same spirit, more polished |
| **App Name** | TBD | **Slotted** | Chosen during development |
| **Platform** | Desktop web only | Desktop web + **PWA** (mobile install prompt) | Added mobile install support early |

### 1.2 Social Battery — Visibility Changes

| Original Plan | Current State | Why |
|---|---|---|
| Friends see 🟢🟡🔴 next to your name | Battery is **never shown to friends** | Showing "🔴 Recharging" next to someone's name creates awkwardness — friends might feel rejected or read too much into it |
| 🟡 Ask Me times shown as "Alex might be free — send a ping" | Ask Me is internal only | Same concern — friends shouldn't see that you're "maybe available" |
| 🔴 Recharging hides slots from friends | Still true — AI respects battery internally | The *hiding* behavior is preserved, just the *display* is removed |
| Battery displayed on friend cards (FriendsPage + DashboardPage) | Removed from both | Battery is a private input to the AI, not a social signal |

**Net effect:** Social Battery still exists as a settings control for the user. The AI still uses it when ranking time slots. But no friend ever sees another friend's battery status.

### 1.3 Trip Buffer — Simplified

| Original Plan | Current State | Why |
|---|---|---|
| Slider: 0–3 days buffer around travel | Two toggles: "Day before trip" / "Day after trip" | A slider implies more precision than users actually need. Most people want either "buffer before", "buffer after", or both — not "2.5 days" |

### 1.4 Friend Calendar Status — Hidden

| Original Plan | Current State | Why |
|---|---|---|
| Show friend's calendar sync status ("❌ Calendar not connected") | **Hidden** — only your own sync status shown | Showing that a friend hasn't connected their calendar pressures them to connect and exposes a private choice. The AI still uses the data internally. |
| Show free block counts ("12 free blocks") per person | **Removed** | Exact counts expose how busy someone is — a private detail. Users just see the AI's ranked suggestions. |
| Dashboard "Free Slots" stat card | Replaced with simple ✅ "Cal synced" indicator | Same reason — the number itself isn't useful to the user and could leak if someone glances at their screen |

### 1.5 Decline Flow — Softened

| Original Plan | Current State | Why |
|---|---|---|
| Binary: "✅ Accept" / "❌ Decline" | Three options: "✅ Accept" / "🤔 Maybe" / "Not this time" | "Decline" feels harsh for social plans. "Not this time" is softer. "Maybe" gives a middle ground that's socially honest. |
| Declined badge: "❌ Declined" | Shows "Not this time" (neutral styling, no ❌) | Same softening — avoids making the decliner feel bad when they see their own response |

### 1.6 Per-Friend Labels — Removed Entirely

| Original Plan | Current State | Why |
|---|---|---|
| Not in original PRD (considered during dev) | **No per-friend labels** (no "group-only" / "1:1 only" tags) | Creates asymmetry — if Alice labels Bob "group only" but Bob labels Alice "1:1 friend", the app encodes a social judgment that could leak. Instead, the choice between 1:1 and group happens naturally per scheduling action. |

### 1.7 Group Scheduling — Pulled Into V1

| Original Plan | Current State | Why |
|---|---|---|
| Explicitly cut from V1 ("MOVED TO V2") | **Included in V1** — Groups page, GroupAvailability panel, friend group CRUD | Natural extension of the unified friend selection flow. Users select 2+ friends → "Find group times" appears automatically. |

### 1.8 Friendship Types — Added

| Original Plan | Current State | Why |
|---|---|---|
| Not in original PRD | Friends tagged as 📍 Local / 📞 Long distance / 🌐 Both | Determines whether to suggest in-person or virtual meetups. Long-distance friends show local time + timezone. Call windows feature supports scheduling across timezones. |

### 1.9 Activity Logging — Added

| Original Plan | Current State | Why |
|---|---|---|
| "Mark as met" button | Full **hangout logging** system: activity type, duration, time of day, vibe rating (1–5 stars) | Richer data for AI to learn preferences. Auto-detection from calendar for confirmed meetups. Manual logging as fallback. "Didn't happen" flow with reason tracking. |

### 1.10 PWA Install — Added

| Original Plan | Current State | Why |
|---|---|---|
| "Desktop web first, mobile in V2" | **PWA with install prompt** — iOS/Android/desktop instructions | Low-effort way to get mobile presence without building native apps. Detects platform and shows appropriate install steps. Dismissable for 7 days. |

---

## 2. Current Feature Map

### ✅ Implemented

| Feature | Page/Component | Notes |
|---|---|---|
| Google OAuth login | AuthContext | Firebase Auth |
| Onboarding survey | OnboardingPage | Preferred times, Social Battery defaults, calendar connection |
| Google Calendar sync | SettingsPage + backend | Real-time via webhooks, sync status shown to user only |
| Apple Calendar connect | SettingsPage | App-specific password flow |
| Social Battery (self) | SettingsPage, SocialBattery component | Open / Ask Me / Recharging — private to user + AI |
| Social frequency preference | SettingsPage | Daily / 2–3×/week / Weekly / Biweekly — "all friends combined" |
| Recharging days | SettingsPage | Per-day-of-week defaults |
| Trip buffer (before/after) | SettingsPage | Two independent toggles |
| Travel buffer (minutes) | SettingsPage | Slider for transit time between events |
| Personal time protection | SettingsPage | Slider controlling how aggressively AI protects free time |
| Planning style | SettingsPage | Flexible / Planner / Spontaneous |
| Preferred time windows | SettingsPage | Multi-select chips |
| Neighborhoods (home + work) | SettingsPage | For location-aware suggestions |
| Office days | SettingsPage | For work-vs-home scheduling |
| Call windows | SettingsPage | For long-distance friend scheduling |
| Manual availability | SettingsPage | Per-day time blocks for non-calendar users |
| Friend requests (email) | FriendsPage | Mutual consent |
| Invite link sharing | FriendsPage | Text / Email / Copy link |
| Invite codes | FriendsPage + InvitePage | Unique per-user invite URLs |
| Friend list with selection | FriendsPage | Tap to select → floating action bar |
| Friendship type labels | FriendsPage | Local / Long distance / Both per friend |
| 1:1 availability matching | FriendAvailability | AI-scored suggestions, book button |
| Group availability matching | GroupAvailability | Multi-person AI scoring |
| Friend groups (CRUD) | FriendsPage | Named groups with emoji, up to 8 members |
| Floating action bar | FriendsPage | 1 selected → "Find 1:1 times", 2+ → "Find group times" |
| Notifications inbox | NotificationsPage | Friend requests, meetup RSVPs, calendar matches, reminders |
| Soft RSVP flow | NotificationsPage | Accept / Maybe / Not this time |
| Dashboard stats | DashboardPage | Friends count, hangouts this month, calendar sync indicator |
| People to See cards | DashboardPage | AI-prioritized friends, last hangout time, long-distance aware |
| Upcoming hangouts | DashboardPage | With RSVP status badges |
| Calendar embed | DashboardPage | Week/Month toggle, Google Calendar iframe |
| Hangout logging | DashboardPage | Activity, duration, time of day, vibe rating |
| Auto-detected hangouts | DashboardPage | From calendar-confirmed meetups |
| "Didn't happen" flow | DashboardPage | With reason selection |
| Learned preferences display | SettingsPage | Shows AI-detected patterns after enough data |
| Progressive profiling | Backend | Learns preferences from behavior, not upfront questions |
| PWA install prompt | InstallPrompt component | iOS / Android / desktop detection |
| Feedback form | SettingsPage | In-app text feedback |

### ❌ Not Yet Built (Still Planned for V1)

| Feature | Original Plan | Status |
|---|---|---|
| SMS bridge for non-users | Twilio integration for friends not on Slotted | Not started |
| Email notification fallback | Email if user not active in 15 min | Not started |
| Counter-propose flow | Show mutual availability when declining | Not started |
| ICS file download | Export confirmed meetups to any calendar | Not started |
| Data export (JSON) | GDPR-compliant personal data export | Not started |
| Account deletion | Immediate data purge | Not started |

### 🔄 Deferred to V2 (Unchanged from Original)

| Feature | Notes |
|---|---|
| Native iOS/Android apps | PWA covers mobile for now |
| Microsoft Outlook integration | Manual entry as fallback |
| Location-based activity suggestions | Yelp/Google Places API |
| Calendar write access (event creation) | ICS download instead |
| In-app messaging | Beyond scheduling pings |
| Weather-aware suggestions | Outdoor activity detection |
| Advanced ML preference model | Currently rule-based with data collection |

---

## 3. Privacy Design Principles (Evolved)

These emerged during development and now guide all feature decisions:

1. **No social judgments encoded** — The app never stores or displays one friend's opinion of another (no "group-only" labels, no battery visibility between friends)
2. **Your data, your eyes** — Calendar sync status, free slot counts, and Social Battery are visible only to the user who set them, never to friends
3. **Soft social language** — "Not this time" instead of "Decline", "Maybe" as a valid option, no ❌ emojis on social responses
4. **AI as mediator** — The AI uses everyone's private data to generate suggestions, but never exposes the raw inputs. Friends see *results* (ranked time slots), not *reasons* ("Alex only has 2 free blocks")
5. **No pressure to connect** — The app never tells a friend "Connect your calendar!" or shows "❌ Calendar not connected" next to their name
6. **Passive learning over explicit labeling** — Preferences are learned from behavior (which times you accept, how long your hangouts are) rather than asking users to label their friends or declare preferences that could feel awkward

---

## 4. File Reference

| File | Purpose |
|---|---|
| [01-onboarding-survey-questions.md](01-onboarding-survey-questions.md) | Original survey question design |
| [02-vibecoding-development-plan.md](02-vibecoding-development-plan.md) | Original 12-week dev plan |
| [03-prd-mvp-v1.md](03-prd-mvp-v1.md) | Original PRD (V1.1) — **use this doc for current state** |
| [04-backlog-v2-v3.md](04-backlog-v2-v3.md) | V2/V3 feature backlog (still valid, some items pulled forward) |
| [05-user-research-interview-guide.md](05-user-research-interview-guide.md) | User research interview guide |
| **[06-mvp-current-state.md](06-mvp-current-state.md)** | **← This doc. Ground truth for what's built.** |
| [07-app-name-options.md](07-app-name-options.md) | App naming exploration |
