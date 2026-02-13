# Vibecoding Development Plan

**Project:** Social Scheduling App - V1 MVP
**Development Approach:** AI-assisted coding with Vibecode/Cursor
**Timeline:** 8–10 weeks (part-time, 15–20 hrs/week)
**Tech Stack:** Node.js/Express backend, React frontend, PostgreSQL, deployed on Railway/Vercel
**Platform:** Desktop web first (mobile V2)
**Calendar:** Google Calendar only (via webhooks for real-time sync)
**AI Positioning:** AI-powered scheduling for friendships, not work

---

## Phase 1: Foundation (Weeks 1–2)

### Milestone 1.1: Project Setup & Authentication

- Initialize repo with Node.js backend + React frontend
- Set up PostgreSQL database schema:
  - **Users** table (`id`, `email`, `name`, `timezone`, `preferences_json`, `created_at`)
  - **Friendships** table (`user_id`, `friend_id`, `status`, `created_at`)
  - **Availability** table (`user_id`, `start_time`, `end_time`, `status`, `is_recurring`)
  - **Meetups** table (`id`, `created_by`, `participants`, `proposed_time`, `status`)
- Implement Google OAuth 2.0 (Sign in with Google)
- Build JWT-based session management

> **Deliverable:** Users can sign up, log in, and see empty dashboard

### Milestone 1.2: Onboarding Survey

- Build 5-step survey form:
  1. Preferred meeting time windows
  2. Protected time setup (recurring blocks)
  3. Social Battery defaults (Open / Ask Me / Recharging)
  4. Travel buffer preferences (before/after travel auto-blocking)
  5. Google Calendar connection (or manual entry trial mode)
- Store preferences in `preferences_json` field
- Manual availability entry form for trial mode users
- Protected time blocks UI (recurring schedule builder)
- Social Battery toggle UI (daily/weekly defaults + per-day override)

> **Deliverable:** New users complete onboarding and set preferences

---

## Phase 2: Calendar Integration (Weeks 3–4)

### Milestone 2.1: Google Calendar API Integration (Real-Time Webhooks)

- OAuth consent screen for Google Calendar read-only access
- Set up Google Calendar push notifications (webhooks) for real-time sync:
  - Register webhook channel for each user's calendar
  - On change notification, fetch updated free/busy data
  - Store as availability blocks in database
  - Renew webhook channels before expiration (7-day cycle)
- Fallback: on-demand sync when user opens app (in case webhook missed)
- Build sync status UI ("Synced in real-time" with last update timestamp)
- Travel event detection: identify multi-day/all-day events and apply user's buffer preferences

> **Deliverable:** Google Calendar users see real-time synced availability

### Milestone 2.2: Manual Entry & ICS Fallback

- Manual recurring availability entry for non-Google users
- ICS file download for confirmed meetups (one-click calendar add)
- "Add to Google Calendar" deep link for confirmed meetups

> **Deliverable:** Non-Google-Calendar users can participate; confirmed meetups easily added to any calendar

---

## Phase 3: Friend Network (Weeks 5–6)

### Milestone 3.1: Friend Management

- Friend request system:
  - Search by email or invite link
  - Mutual consent (pending → accepted states)
  - Friend list with profile photos
- Friend profile view:
  - Last met date (manual entry initially)
  - Preferred meeting times overlay
  - "See mutual availability" button

> **Deliverable:** Users can connect with friends

### Milestone 3.2: AI-Powered Availability Matching Engine

- Smart algorithm to find and rank mutual free time:
  - Query both users' availability for next 14 days
  - Filter by user preferences (time-of-day preferences from onboarding)
  - Respect Social Battery status (🟢 Open = show, 🟡 Ask Me = show with note, 🔴 Recharging = hide)
  - Score time slots using AI scoring model:
    - Preference match (both prefer weekends = higher score)
    - Social energy alignment (both 🟢 Open > one 🟡 Ask Me)
    - Buffer quality (not back-to-back with other events)
    - Time-of-day social value (Friday 7pm > Tuesday 10am for social)
    - Cadence awareness (if met recently, configurable: lower priority or same)
  - Return top 5 ranked time slots with confidence scores
- Data collection for AI learning:
  - Log which suggestions users view, click, accept, decline
  - Store as training data for future preference model
- Availability calendar view:
  - Heatmap showing mutual free time
  - Click to propose a time

> **Deliverable:** Users see AI-ranked mutual availability with friends

---

## Phase 4: Scheduling Flow (Weeks 7–8)

### Milestone 4.1: "Ping" Notification System

- In-app notification center:
  - "Sarah wants coffee Saturday 2pm—are you free?"
  - Quick actions: Accept / Decline / Counter-propose
- Email notification fallback (if user not active in app)
- Counter-proposal flow:
  - Suggest alternative from mutual free times
  - Shows as new ping to original proposer

> **Deliverable:** Users can propose and respond to hangouts

### Milestone 4.2: SMS Bridge for Non-Users

- Twilio integration:
  - Users can invite friends via SMS
  - Non-users receive: *"Sarah wants coffee Sat 2pm at Blue Bottle. Reply YES, NO, or suggest another time: [link]"*
  - SMS responses create temporary guest accounts
  - If they reply YES, show landing page: *"Sarah confirmed! Download the app to schedule more easily next time"*
- Track SMS costs per user

> **Deliverable:** Non-users can participate via SMS

---

## Phase 5: Polish & Launch Prep (Weeks 9–10)

### Milestone 5.1: AI Learning & Suggested Cadence

- Track meetup history (when users mark "We met")
- Calculate average days between meetups per friend pair
- Show in friend profile: *"You typically see Alex every 18 days. It's been 22 days—want to schedule something?"*
- Begin training preference model on collected data:
  - Which time slots users accept vs. decline
  - Social Battery patterns (do they always override 🔴 on Fridays?)
  - Preferred hangout durations (learned from confirmed meetups)
- Surface AI insights: *"You and Alex mostly grab coffee on Saturday mornings"*

> **Deliverable:** App proactively suggests check-ins; AI begins personalizing

### Milestone 5.2: Privacy & Settings

- User settings page:
  - Manage Google Calendar connection
  - Update preferences/protected time/Social Battery defaults
  - Travel buffer preferences
  - Privacy controls (who can see availability)
  - Delete account / export data
- Privacy policy & terms of service
- GDPR-compliant data deletion workflow

> **Deliverable:** Privacy controls implemented

---

## Phase 6: Testing & Deployment (Weeks 11–12)

### Milestone 6.1: Beta Testing

- Deploy to staging environment
- Recruit 3–5 friend groups (15–20 total users)
- User testing feedback loops
- Bug fixes and UX improvements

> **Deliverable:** Beta users scheduling successfully

### Milestone 6.2: Production Launch

- Deploy to production (Railway backend + Vercel frontend recommended)
- Set up monitoring (error tracking, API cost tracking)
- Create landing page with waitlist
- Soft launch to beta users' networks

> **Deliverable:** App live and usable

---

## Key Vibecode Prompts to Use

### For Google Calendar webhook integration:

```text
Build a Node.js service that authenticates with Google Calendar API 
using OAuth 2.0 with refresh tokens. Use push notifications (webhooks) 
for real-time calendar sync instead of polling. Register a webhook 
channel per user, handle change notifications to fetch updated 
free/busy data for the next 30 days, and store in PostgreSQL. Include 
webhook channel renewal logic (7-day expiry). Add travel detection: 
when an all-day or multi-day event is detected, auto-block the day 
before/after based on user preferences.
```

### For AI matching algorithm:

```text
Write a function that takes two users' availability arrays, their 
preferences (time-of-day, Social Battery status), and meetup history, 
then returns mutual free time slots. Score by: 1) preference match 
(weighted 2x if both prefer this window), 2) Social Battery alignment 
(both "Open" scores highest), 3) social context (Friday evening > 
Tuesday morning for social plans), 4) buffer quality (penalize if 
<30min gap before/after). Log all suggestions shown + user actions 
(view/click/accept/decline) as training data. Return top 5 as JSON 
with confidence scores.
```

### For SMS bridge:

```text
Integrate Twilio to send SMS invites when a user proposes a time to 
a non-user friend. Format: "X wants to meet [activity] [date/time]. 
Reply YES, NO, or counter." Handle inbound SMS webhooks to update 
meetup status in database.
```

### For AI preference learning:

```text
Build a lightweight preference model that improves scheduling 
suggestions over time. Input features: time-of-day, day-of-week, 
advance notice (days until meetup), Social Battery status at time of 
acceptance, friend pair meetup history count, activity type. Output: 
probability of acceptance (0-1). Train on user interaction logs 
(accepted, declined, counter-proposed, ignored). Use logistic 
regression or small gradient-boosted model (scikit-learn). Retrain 
weekly. Fall back to rule-based scoring if <20 data points per user.
```
