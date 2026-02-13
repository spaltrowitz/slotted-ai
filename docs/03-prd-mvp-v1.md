# Product Requirements Document: Social Scheduling App V1

| Field | Value |
|---|---|
| **Version** | 1.1 |
| **Last Updated** | February 12, 2026 |
| **Product Owner** | [Your Name] |
| **Status** | Pre-Development |

---

## 1. Executive Summary

**Problem:** Scheduling recurring social meetups with close friends requires excessive back-and-forth texting and manual calendar coordination. Existing solutions (Doodle, shared calendars) create friction by requiring manual time proposals or exposing too much calendar detail.

**Solution:** An AI-powered social scheduling app that syncs friends' Google Calendars (free/busy only), proactively suggests optimal meeting times based on mutual availability, preferences, and learned behavior patterns. The goal: reduce scheduling coordination time by 80%.

**Target Market:** Busy young professionals aged 25–40 who maintain 5–15 close friendships and value efficiency in social planning. Initial focus on tech-savvy professionals who use Google Calendar.

**Platform:** Desktop web app first (React SPA). Mobile in V2.

### Success Metrics

| Metric | Target |
|---|---|
| Users who schedule ≥1 meetup within first week | 30% |
| Weekly retention at 4 weeks | 50% |
| Average connected friends per active user | 3+ |
| Reduction in "time to schedule" vs. manual coordination (user survey) | 80% |

---

## 2. User Personas

### Primary: "Busy Professional Bailey"

- **Age:** 25–35
- **Job:** Program manager, product designer, software engineer, or similar
- **Pain:** Wants to maintain friendships but struggles with coordination overhead. Calendar is packed with work; social plans fall through the cracks.
- **Calendar:** Google Calendar, highly scheduled
- **Motivation:** Values efficiency, willing to try new tools that save time
- **Platform:** Desktop during work hours, mobile for quick responses (V2)

### Secondary: "Active Lifestyle Alex"

- **Age:** 25–35
- **Job:** Various, may have flexible schedule
- **Pain:** Coordinates multiple activity groups (climbing, hiking, sports) via group chats
- **Calendar:** Google Calendar with irregular scheduling
- **Motivation:** Wants more spontaneous hangouts without constant texting; open to AI suggestions

---

## 3. Core Features (V1 MVP)

### 3.1 User Authentication & Onboarding

- **OAuth login:** Google OAuth only (for both authentication and calendar access)
- **Onboarding survey:** 5 questions to capture:
  1. Preferred time windows (weekday mornings, evenings, weekends, etc.)
  2. Protected time setup (optional recurring blocks)
  3. Social Battery defaults (Open to plans / Ask me / Recharging)
  4. Travel buffer preferences (auto-block day before/after travel)
  5. Google Calendar connection or manual entry
- **Progressive profiling:** Meeting style (spontaneous vs. planned), hangout duration, and activity preferences are learned automatically as users schedule meetups — not asked upfront
- **Privacy education:** Clear explanation of free/busy-only visibility before calendar connection
- **Trial mode:** 7-day manual availability entry for users hesitant about calendar access

**Acceptance Criteria:**
- User can complete onboarding in <2 minutes
- Preferences stored and editable in settings
- Privacy tooltip explains exactly what friends see

### 3.2 Calendar Integration

- **Supported platform:** Google Calendar only (V1)
- **Permission scope:** Read-only free/busy data (no event titles, attendees, or locations)
- **Sync method:** Google Calendar push notifications (webhooks) for real-time sync
  - Webhook channel registered per user, renewed every 7 days
  - On-demand sync triggered when user opens app (fallback)
- **Sync window:** Next 30 days of availability
- **Travel detection:** Identify all-day/multi-day events and auto-block buffer days per user preference
- **Manual alternative:** Users can enter recurring blocks if not using Google Calendar
- **Confirmed meetup export:** ICS file download + "Add to Google Calendar" deep link

**Data Model:**

```
Availability {
  user_id: UUID
  start_time: DateTime
  end_time: DateTime
  status: ENUM('free', 'busy')
  social_battery: ENUM('open', 'ask_me', 'recharging')
  is_recurring: Boolean
  recurrence_rule: String (optional)
  source: ENUM('calendar_sync', 'manual', 'protected_time', 'travel_buffer')
}
```

**Acceptance Criteria:**
- Calendar syncs in real-time via webhooks (within 30 seconds of change)
- Status indicator shows sync method and last update timestamp
- User can disconnect calendar and revert to manual entry
- Travel buffers auto-applied when multi-day events detected
- Non-Google users see instructions to enter availability manually

### 3.3 Social Battery System

| Status | Icon | Description |
|---|---|---|
| **Open to plans** | 🟢 | Actively wants to see friends; shown to friends as available |
| **Ask me** | 🟡 | Could be convinced for the right hangout; shown with note |
| **Recharging** | 🔴 | Technically free but not socially available; hidden from friends |

**User Controls:**
- Set **weekly defaults** during onboarding (e.g., "Recharging on Sundays")
- **Override any specific day** ("I'm 🟢 Open this Sunday actually")
- AI learns overriding patterns over time ("You usually switch to Open on Fridays")
- Mark recurring protected time (gym, date nights, personal time) — always shows as busy
- **Travel buffer mode:** when travel detected, auto-applies user's buffer preference (day before, day after, or both)

**How friends see it:**
- 🟢 Open slots show normally in mutual availability
- 🟡 Ask Me slots show with note: *"Alex might be free — send a ping to check"*
- 🔴 Recharging slots are completely hidden (treated as busy)

**Acceptance Criteria:**
- Users can set weekly Social Battery defaults
- Per-day override available from dashboard
- Protected time displays as busy (no details visible)
- Travel buffers auto-applied based on user preferences

### 3.4 Friend Network

- **Friend requests:** Mutual consent required (search by email or shareable invite link)
- **Friend states:** Pending → Accepted
- **Friend limit (V1):** 15 friends max per user (manage infrastructure costs)
- **Friend profiles show:**
  - Name, profile photo
  - Preferred meeting times (from their survey)
  - Last met date (manual entry)
  - Suggested cadence (calculated from history)

**Acceptance Criteria:**
- User can send friend request via email or link
- Both parties must accept to connect
- Friend list sortable by "last met" date
- Can remove friends with confirmation dialog

### 3.5 AI-Powered Availability Matching Engine

**Algorithm Logic:**

1. **Find mutual free time:** Query both users' availability for next 14 days
2. **Filter by constraints:**
   - Minimum meeting duration (learned from past meetups, default 1hr)
   - User time-of-day preferences (from onboarding)
   - Social Battery: show 🟢 Open normally, 🟡 Ask Me separately, hide 🔴 Recharging
3. **AI Scoring Model:**

```
Score = f(Preference Match, Social Battery Alignment, Social Context, Buffer Quality, Cadence)

Where:
- Preference Match: 2.0 if both prefer this time window, 1.0 if one prefers, 0.5 if neither
- Social Battery: 1.0 if both 🟢 Open, 0.7 if one 🟡 Ask Me, 0.3 if both 🟡
- Social Context: Time-of-day multiplier (Fri 7pm = 1.5x, Tue 10am = 0.5x for social)
- Buffer Quality: 1.0 if 30min+ buffer before/after, 0.7 if <30min
- Cadence: Configurable per friend pair (default: neutral; opt-in to "spread out" mode)
```

4. **Return top 5** ranked slots with confidence scores
5. **Data Collection:** Log all suggestions shown + user actions (view, click, accept, decline, counter-propose, ignore) as training data for the AI preference model

**AI Learning Pipeline (V1 Foundation):**
- Collect interaction data from day 1
- After ~20 data points per user, begin weighting AI model over rule-based scoring
- Learn implicitly: hangout duration preferences, spontaneous vs. planned style, activity patterns
- Retrain model weekly

**UI Display:**
- Calendar heatmap showing mutual availability
- List view of AI-ranked suggestions with confidence indicators
- 🟡 Ask Me times shown in separate expandable section
- *"Why this time?"* tooltip explaining AI reasoning

**Acceptance Criteria:**
- Algorithm returns results in <2 seconds
- Results reflect both users' preferences and Social Battery
- User can manually override and propose any time (even if not suggested)
- All user interactions with suggestions are logged for AI training

### 3.6 Scheduling "Ping" Flow

**Initiation:**
- User selects friend + time + optional activity/location
- Clicks "Propose hangout"
- System sends notification

**Notification Channels:**
- **In-app:** Real-time if recipient is active
- **Email:** If no in-app engagement within 15 minutes
- **SMS (future):** For urgent or non-user invites

**Recipient Actions:**
- ✅ **Accept** → Adds to both calendars (manual or via export)
- ❌ **Decline** → Notifies proposer
- 🔄 **Counter-propose** → Shows mutual availability picker

**For "Ask Me" Times:**
- Ping message: *"Sarah wants coffee Saturday 2pm—you marked this as '🟡 Ask Me.' Can you make it work?"*
- Encourages confirmation before finalizing

**Acceptance Criteria:**
- Notifications delivered within 30 seconds
- Users can respond with 1 click
- Counter-proposals show only mutually free times
- Ping history visible in user profile

### 3.7 SMS Bridge for Non-Users

**Flow:**
1. User proposes time to friend not on the app
2. App prompts: *"Sarah isn't on [App Name] yet. Send via SMS?"*
3. User enters friend's phone number
4. Friend receives: *"Sarah wants coffee Saturday 2pm at Blue Bottle. Reply YES, NO, or LINK to suggest another time."*
5. SMS responses handled:
   - **YES** → Notification to proposer + landing page invite
   - **NO** → Notification to proposer
   - **LINK** → Opens web form (no account needed) to pick alternate times

**Cost Tracking:**
- Limit to 20 SMS/user/month on free tier
- Display SMS count in settings

**Acceptance Criteria:**
- Twilio integration sends within 10 seconds
- Inbound SMS responses update database
- Non-users can participate without creating account
- Landing page converts SMS respondents to signups

### 3.8 Suggested Cadence Tracking

**Data Collection:**
- Users manually mark "We met!" after hangouts (optional but encouraged)
- System calculates average days between meetups per friend pair

**Display:**
- Friend profile shows: *"You typically see Alex every 18 days. It's been 22 days—here are upcoming free times."*
- Gentle nudge, not aggressive notifications

**Acceptance Criteria:**
- Cadence calculation accurate after ≥3 logged meetups
- Suggestion appears in friend profile (not push notification in V1)
- User can dismiss or adjust cadence preference

### ~~3.9 Small Group Scheduling (3 People Max)~~ — MOVED TO V2

> Group scheduling cut from V1 to focus on 1:1 friend scheduling. See [V2/V3 Backlog](04-backlog-v2-v3.md).

### 3.10 Privacy & Settings

**User Controls:**
- Manage Google Calendar connection (connect/disconnect, sync status)
  - Update preferences/protected time/Social Battery defaults
  - Travel buffer preferences
- Privacy settings:
  - Who can send you friend requests (anyone with email, friends-of-friends, no one)
  - Vacation message visibility (hidden, custom message, location name)
- Data management: Export all data (JSON), delete account (immediate purge)

**Privacy Guarantees:**
- Friends see only free/busy blocks (no event details)
- No data sold to third parties (explicit in ToS)
- GDPR-compliant: right to access, rectification, deletion
- Data encrypted at rest (AES-256) and in transit (TLS 1.3)

**Acceptance Criteria:**
- All privacy controls functional in settings page
- Data export completes in <30 seconds
- Account deletion removes all data within 24 hours
- Privacy policy clearly explains data handling

---

## 4. Non-Functional Requirements

### 4.1 Performance

| Metric | Target |
|---|---|
| Page load time | <2 seconds on 4G connection |
| Availability matching | <2 seconds for 1:1 pairs |
| Calendar sync | Real-time via webhooks (within 30 seconds) |
| Uptime | 99.5% |

### 4.2 Security

- OAuth 2.0 with PKCE for all authentication
- JWT tokens with 7-day expiration
- Rate limiting: 100 API calls/user/hour
- SQL injection prevention via parameterized queries
- XSS protection via Content Security Policy headers

### 4.3 Scalability

- Support 1,000 users in first 3 months
- Database designed for 10K+ users (sharding ready)
- API cost monitoring dashboard

### 4.4 Accessibility

- WCAG 2.1 AA compliance
- Keyboard navigation support
- Screen reader compatible
- High contrast mode

---

## 5. User Stories

### Epic 1: Onboarding

- As a new user, I want to sign up with Google in <1 minute so I can start quickly
- As a privacy-conscious user, I want to try the app without connecting my calendar so I can evaluate it first

### Epic 2: Availability Management

- As a user, I want my Google Calendar to sync in real-time so availability is always current
- As a user, I want to set my Social Battery to "🔴 Recharging" on Sundays so friends don't see me as free

### Epic 3: Friend Coordination

- As a user, I want to see when Sarah and I are both free next week so we can grab coffee
- As a user, I want to propose Saturday 2pm with one click so Sarah can accept quickly

### Epic 4: ~~Group Scheduling~~ AI Learning

- As a user, I want suggestions to get smarter over time based on which times I accept
- As a user, I want to invite my non-app-using friend via SMS so I don't exclude them

---

## 6. Technical Architecture

### Frontend

- React 18 with TypeScript
- Tailwind CSS for styling
- React Query for API state management
- Deployed on Vercel

### Backend

- Node.js 20 with Express
- PostgreSQL 15 database
- Redis for caching availability queries
- Google Calendar webhooks for real-time sync (no polling cron needed)
- Deployed on Railway or Render

### External APIs

- Google Calendar API (OAuth + webhooks)
- Twilio SMS API

### Infrastructure

- **CDN:** Cloudflare
- **Monitoring:** Sentry (errors), Plausible (analytics)
- **Auth:** Auth0 or custom JWT implementation

---

## 7. Success Metrics & KPIs

### Activation Metrics (First 7 Days)

| Metric | Target |
|---|---|
| % users who complete onboarding | 80% |
| % users who connect calendar | 60% |
| % users who send ≥1 friend request | 70% |
| % users who schedule ≥1 meetup | 30% |

### Engagement Metrics (30 Days)

| Metric | Target |
|---|---|
| Weekly active users (WAU) | 50% of signups |
| Average # of connected friends | 3+ |
| Average meetups scheduled per user per month | 2+ |
| Repeat scheduling rate | 60% schedule second meetup |

### Retention Metrics

| Metric | Target |
|---|---|
| Day 7 retention | 40% |
| Day 30 retention | 25% |
| Month 2–3 retention | 15% |

### Network Effects

| Metric | Target |
|---|---|
| % of users who invite ≥1 friend | 50% |
| Average friend acceptance rate | 60% |

---

## 8. Launch Plan

### Phase 1: Private Beta (Weeks 11–12)
- Invite 3–5 friend groups (15–20 users total)
- Focus on climbing/outdoor community (your network)
- Collect feedback via weekly surveys

### Phase 2: Soft Launch (Month 4)
- Open to beta users' networks (referral-only)
- Target 100 users
- Monitor costs and performance

### Phase 3: Public Launch (Month 5–6)
- Landing page with waitlist
- ProductHunt launch
- Reddit community posts (r/productivity, r/socialskills)
- Target 1,000 users in first 3 months

---

## 9. Open Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Users hesitant to grant calendar access | High — core feature blocked | Offer 7-day trial mode with manual entry; strong privacy messaging |
| Network effects slow (friends don't join) | High — app useless alone | SMS bridge for non-users; incentivize invites |
| Calendar API costs exceed budget | Medium — profitability risk | Free tier with 5 friend limit; $5/mo for unlimited |
| Apple Calendar integration too complex | Low — workaround exists | Defer to V2; provide manual entry as alternative |
| Microsoft Outlook not supported | Low — small % of target demo | Google Calendar covers 60-70% of target users; manual entry fallback |
| Scheduling suggestions miss the mark | Medium — trust loss | Manual override always available; collect feedback on suggestions |

---

## 10. Out of Scope for V1

- ❌ Activity recommendations based on location (V2)
- ❌ Groups larger than 3 people (V2)
- ❌ Group scheduling of any size (V2 — cut from V1)
- ❌ In-app messaging beyond scheduling (V2)
- ❌ Calendar write access (creating events) — ICS download provided instead (V2)
- ❌ Native iOS/Android apps (V2)
- ❌ Microsoft Outlook / Apple Calendar integration (V2)
- ❌ Integration with booking platforms (OpenTable, etc.) (V3)
- ❌ ML-based activity type detection (V2)
- ❌ Social media profile linking (V3)
