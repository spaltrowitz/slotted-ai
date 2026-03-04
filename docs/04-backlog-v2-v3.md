# Feature Backlog: V2/V3

**Prioritization Framework:** RICE Score (Reach × Impact × Confidence / Effort)

---

## V2 Features (6–12 Months Post-Launch)

**Goal:** Enhance core scheduling with intelligence and broader platform support

---

### P0 (Must-Have for V2)

#### 1. Group Scheduling (3 People, then 4–6)

- **Description:** Support small group scheduling, starting with 3-person matching, expanding to 4–6
- **User Value:** Enables group dinners, climbing sessions, game nights
- **Requirements:**
  - Matching algorithm for 3–6 person groups
  - Partial availability mode ("4 out of 6 can make it—good enough?")
  - Group ping flow (all must respond)
  - Group chat-style thread for coordination
- **Effort:** 3 weeks (algorithm complexity, UI)
- **RICE Score:** (600 users × 7 impact × 60% confidence) / 3 = **840**

#### 2. Microsoft Outlook / Apple Calendar Integration

- **Description:** Expand beyond Google Calendar to support Outlook (Microsoft Graph API) and Apple Calendar (CalDAV)
- **User Value:** Unlocks 30–40% of potential users who don't use Google Calendar
- **Requirements:**
  - Microsoft Graph API authentication + webhook sync
  - CalDAV authentication flow with app-specific passwords for Apple
  - Unified sync service across all three calendar platforms
  - Clear setup instructions for each platform
- **Effort:** 5 weeks (two integrations)
- **RICE Score:** (400 new users × 8 impact × 60% confidence) / 5 = **384**

#### 3. Activity Type Detection & Suggestions

- **Description:** ML model learns patterns (e.g., "You and Alex typically grab 1hr coffee on weekend mornings") and suggests appropriate activities
- **User Value:** Reduces decision fatigue; makes suggestions more contextual
- **Requirements:**
  - Track activity type when users mark "We met!" (coffee, dinner, hike, gym, etc.)
  - After 6+ logged meetups, detect patterns
  - Surface as: *"Based on past hangouts, want to grab coffee Saturday 10am?"*
- **Effort:** 3 weeks (ML training, UI updates)
- **RICE Score:** (500 users × 8 impact × 70% confidence) / 3 = **933**

#### 4. Location-Based Activity Suggestions

- **Description:** Suggest nearby activities (restaurants, parks, events) for proposed times
- **User Value:** Reduces "where should we meet?" friction
- **Requirements:**
  - Integrate Yelp or Google Places API
  - Filter by activity type and user preferences (from survey)
  - Show 3–5 options when confirming a time
  - Optional: link to OpenTable/Resy for reservations
- **Effort:** 2 weeks (API integration, UI)
- **RICE Score:** (600 users × 5 impact × 80% confidence) / 2 = **1200**

---

### P1 (Should-Have for V2)

#### 5. Native Mobile Apps (iOS & Android)

- **Description:** React Native apps for better push notifications and native calendar access
- **User Value:** Improved notification delivery; easier calendar permissions on mobile
- **Requirements:**
  - React Native setup (shared codebase with web)
  - Native calendar API access (iOS EventKit, Android CalendarProvider)
  - Push notification infrastructure (Firebase Cloud Messaging)
- **Costs:**
  - **Apple Developer Program:** $99/year (required to publish on iOS App Store)
  - **Google Play Store:** $25 one-time fee (required to publish on Android)
  - **In-app purchases/subscriptions:** Apple/Google take 30% commission (15% if under $1M annual revenue via Small Business Program)
  - **Total upfront:** $124 + ongoing $99/year for iOS renewals
  - **Alternative to App Store:** No legitimate way to avoid fees for individual developers. Enterprise programs ($299/yr) are for internal distribution only. TestFlight (beta testing) is free but limited to 10,000 users for 90 days.
- **Effort:** 8 weeks (full native development)
- **RICE Score:** (1000 users × 9 impact × 70% confidence) / 8 = **788**

#### 6. Advanced Preference Learning

- **Description:** ML model learns from accepted/rejected suggestions to improve recommendations
- **User Value:** Suggestions get smarter over time without manual input
- **Requirements:**
  - Track which suggested times users accept vs. decline
  - Train model on features: time-of-day, advance notice, day-of-week, weather (optional)
  - A/B test ML suggestions vs. rule-based
- **Effort:** 4 weeks (data pipeline, model training)
- **RICE Score:** (800 users × 7 impact × 60% confidence) / 4 = **840**

#### 6b. Dashboard "Ideal Time" Suggestions (Private)

- **Description:** Show 1–3 private "ideal time to make plans" windows on Dashboard, combining friend cadence (time since last hangout), user interests, and overlap availability.
- **User Value:** Helps users act at the right moment without opening multiple tabs or feeling social pressure.
- **Requirements:**
  - Compute lightweight weekly suggestion windows from existing availability + friendship cadence signals
  - Keep suggestions private to the user (never visible to friends)
  - One-tap CTA from each suggestion to Friends "Find times" flow
  - Soft language ("good window to reach out") with no ranking/pressure score UI
- **Effort:** 2 weeks
- **RICE Score:** TBD

#### 7. Recurring Social Commitments

- **Description:** Set up standing hangouts ("Coffee with Sarah every other Saturday 10am")
- **User Value:** Automates scheduling for regular meetups
- **Requirements:**
  - UI to create recurring meetup (frequency, time, attendees)
  - Auto-check availability for next occurrence
  - Notify if someone's calendar conflicts, suggest reschedule
  - Option to skip individual occurrences
- **Effort:** 2 weeks
- **RICE Score:** (500 users × 8 impact × 80% confidence) / 2 = **1600**

#### 7b. Couple Mode (Linked Scheduling Units)

- **Description:** Allow two users to link as a couple, pre-merging their combined availability into a single scheduling unit. When someone invites "The Smiths," the app automatically intersects both calendars and treats them as one participant.
- **User Value:** Matches how couples actually schedule ("Can you and Mike do Saturday?"). Massively simplifies group coordination for dinner-with-couples scenarios — 3 couples = 3 units, not 6 individual calendars. Enables pre-cached availability that eliminates cold-start sync delays at query time.
- **Requirements:**
  - Couple linking flow: mutual opt-in (both partners confirm)
  - Combined availability computed on each calendar webhook (pre-cached, not at query time)
  - Friend list shows couple as a single selectable unit (with option to select individually)
  - Group overlap uses pre-merged couple slots instead of syncing both people live
  - Privacy: each partner can temporarily "unlink" for solo scheduling without breaking the pair
  - Edge cases: one partner disconnects calendar, one is recharging, couple breaks up (unlink)
- **Performance benefit:** Pre-computed couple availability eliminates live calendar syncs at query time. A 3-couple dinner goes from 6 API calls + 6-way intersection to 0 API calls + 3-way intersection of cached slots (<1 second vs. 5-10 seconds).
- **Effort:** 3 weeks (linking flow, cached availability pipeline, UI for couple units)
- **RICE Score:** (400 users × 8 impact × 70% confidence) / 3 = **747**

#### 7c. Two-Way Calendar Sync (RSVP & Event Changes Flow Back to Slotted)

- **Description:** When Slotted auto-adds a meetup to a user's Google or Apple calendar, changes made in the native calendar app (accept, decline, maybe, time change, deletion) should flow back into Slotted and trigger appropriate updates — status changes, notifications to other participants, and UI updates.
- **User Value:** Eliminates the "two sources of truth" problem. Users can manage their social calendar from wherever they are (phone calendar, desktop, Slotted app) and everything stays in sync. Without this, declining in Google Calendar doesn't cancel the Slotted meetup, creating ghost plans.
- **Origin:** Beta feedback from Tamer (Feb 2026) — after auto-add was implemented, he immediately asked "what happens if I change it in Google Calendar?"
- **Technical Approach:**

  **Google Calendar (near real-time via webhooks):**
  - Use `calendar.events.watch()` to set up a push notification channel per user
  - New endpoint: `POST /calendar/webhook` receives Google push notifications
  - On notification: fetch changed events, match to Slotted meetups via `google_event_id`
  - Map Google RSVP status → Slotted RSVP: `accepted` → accepted, `declined` → declined, `tentative` → maybe, event deleted → declined
  - Detect time changes: if event start/end differs from meetup start/end → flag for counter-propose flow
  - Watch channels expire after ~7 days — need a scheduled function to renew them
  - Handle rate limits: Google sends a sync notification, then you must fetch the actual changes

  **Apple Calendar (polling, delayed):**
  - No webhook support — must poll CalDAV periodically (every 5-15 min via scheduled function)
  - Use CalDAV REPORT to detect changes since last sync token
  - Match events to Slotted meetups via the deterministic UID (`slotted-{meetupId}-{userId}@slotted-ai.web.app`)
  - Parse VEVENT changes: PARTSTAT field for RSVP, DTSTART/DTEND for time changes, absence = deletion

  **Conflict resolution rules:**
  - Slotted is source of truth for multi-party state (who's invited, overall meetup status)
  - Calendar is source of truth for individual RSVP and personal time changes
  - If someone moves just their calendar event (not a counter-propose), only update their participant record — don't move the meetup for everyone
  - If someone deletes the calendar event, treat as "declined" in Slotted

- **Requirements:**
  - `POST /calendar/webhook` endpoint for Google push notifications
  - Watch channel creation on calendar connect + scheduled renewal (`sendMeetupReminders` or new function)
  - Event change diffing: compare fetched event to stored meetup, update participant RSVP
  - Notification dispatch: "Josh updated their RSVP to maybe for Saturday hangout"
  - Apple: scheduled polling function (every 10 min) with CalDAV REPORT
  - Edge cases: user disconnects calendar, event modified by someone else (shared calendar), Google API quota limits

- **Effort:** 2-3 weeks (Google webhook: 1 week, Apple polling: 1 week, conflict resolution + edge cases: 3-5 days)
- **RICE Score:** (500 users × 9 impact × 60% confidence) / 3 = **900**
- **Dependencies:** Auto-add to calendar (already shipped), `google_event_id` stored on meetup_participants (already done)

---

### P2 (Nice-to-Have for V2)

#### 8. Calendar Write Access (Event Creation)

- **Description:** Automatically create calendar events when meetup is confirmed, using incremental Google OAuth scopes
- **User Value:** One less manual step (currently users use a deep link or .ics download). Truly seamless — event appears silently on their calendar after one-time consent.
- **Requirements:**
  - Implement incremental Google OAuth: request read-only at signup, prompt for `calendar.events` write scope only when user first tries to add an event
  - Store upgraded token alongside existing read-only token
  - Create event via Google Calendar API silently after first consent
  - **Include attendee emails** in the created event so Google sends calendar invites to all participants automatically
  - Handle Apple Calendar via .ics download fallback (no reliable web API exists)
  - Include attendee emails in event so it sends Google Calendar invites to participants
- **Note:** Google will show a scarier permission screen for write access ("manage your calendar events"). Using incremental scopes avoids showing this at signup, preserving low-friction onboarding.
- **Effort:** 2 weeks
- **RICE Score:** (600 users × 5 impact × 70% confidence) / 2 = **1050**

#### 9. Weather-Aware Suggestions

- **Description:** Factor in weather forecasts for outdoor activities
- **User Value:** Avoids suggesting "hike Saturday" when rain is forecasted
- **Requirements:**
  - Integrate OpenWeather or similar API
  - Tag activities as indoor/outdoor in user preferences
  - Deprioritize outdoor times if poor weather predicted
- **Effort:** 1 week
- **RICE Score:** (300 users × 4 impact × 60% confidence) / 1 = **720**

#### 10. Timezone Intelligence for Traveling Friends

- **Description:** Auto-detect when friends are in different timezones and adjust suggestions
- **User Value:** Handles remote friends or travel scenarios elegantly
- **Requirements:**
  - Detect timezone changes from calendar sync
  - Show availability in both timezones
  - Highlight when someone is traveling: *"Alex is in London this week (GMT)"*
- **Effort:** 2 weeks
- **RICE Score:** (200 users × 6 impact × 70% confidence) / 2 = **420**

#### 11. Multi-Channel Notifications

- **Description:** Add notification channels beyond in-app (web push, email, SMS) to ensure users see time-sensitive alerts
- **User Value:** Don't miss calendar matches, meetup invites, or confirmations when not actively in the app
- **Status:** ✅ Web Push implemented, Email & SMS pending
- **Options:**
  - **Web Push Notifications** (Tier 1 — ✅ IMPLEMENTED)
    - Uses Service Worker + Web Push API (PWA infrastructure)
    - Native OS notifications even when browser is closed (works great on Android/desktop, okay on iOS Safari 16.4+)
    - **Cost:** Free
    - **Use for:** Calendar matches, meetup invites, acceptances, reminders
    - **Setup:** See [docs/08-web-push-notifications-setup.md](./08-web-push-notifications-setup.md)
    - **Files:** 
      - `client/public/firebase-messaging-sw.js` - Service worker
      - `client/src/hooks/usePushNotifications.ts` - FCM token management
      - `client/src/components/PushNotificationPrompt.tsx` - Permission UI
      - `functions/src/index.ts` - `createNotification()` sends FCM push
      - `database/schema.sql` - `fcm_tokens` table
  - **Email Notifications** (Tier 2 — reliable backup)
    - SendGrid (100/day free tier), AWS SES ($0.10/1000), Postmark
    - **Cost:** Free at MVP scale
    - **Use for:** Daily/weekly digests, meetup confirmations, friend accepted
    - **Effort:** 2 weeks (templates + sending infrastructure)
  - **SMS Notifications** (Tier 3 — premium feature)
    - Twilio (~$0.0079/SMS US), AWS SNS, Plivo
    - **Cost:** ~$0.01/message (2-4 texts/month = $0.02-0.04/user/month)
    - **Use for:** Meetup confirmed (1x), reminder 2hrs before (1x)
    - **Monetization:** Could be Pro tier feature ($2-3/mo)
    - **Effort:** 2 weeks (Twilio integration + phone number collection + TCPA compliance)
- **Implementation Priority:** ✅ Web Push → Email → SMS
- **Total Effort:** 1 week (web push) + 4 weeks (email + SMS)
- **RICE Score (Web Push only):** (800 users × 8 impact × 80% confidence) / 1 = **5120**

---

## V3 Features (12–24 Months Post-Launch)

**Goal:** Ecosystem expansion and network growth

---

### P0 (Must-Have for V3)

#### 11. "Share Your Socials" Profile Page

- **Description:** Optional profile section where users list social media handles (Strava, Beli, Instagram, etc.)
- **User Value:** Easy discovery of friends' other platforms without forced integration
- **Requirements:**
  - Profile edit page with social media fields
  - Display on friend profile with clickable icons
  - No API integration—just static links
  - Privacy control: hide from specific friends if desired
- **Effort:** 1 week
- **RICE Score:** (1000 users × 4 impact × 90% confidence) / 1 = **3600**

#### 12. Friend Group Templates

- **Description:** Save recurring groups (e.g., "Book Club," "Climbing Crew," "Dinner Squad") for quick scheduling
- **User Value:** Reduces friction for scheduling the same group repeatedly
- **Requirements:**
  - Create group with custom name + 3–6 members
  - "Schedule with [Group Name]" quick action
  - Group-level preferences (typical activity, meeting length)
- **Effort:** 2 weeks
- **RICE Score:** (800 users × 7 impact × 80% confidence) / 2 = **2240**

#### 13. Social Calendar Analytics

- **Description:** Personal insights on social habits (friends seen most/least, busiest times, cadence tracking)
- **User Value:** Gamification + awareness of social balance
- **Requirements:**
  - Dashboard with visualizations:
    - Friends ranked by meetup frequency
    - Heatmap of social activity by day/time
    - Streaks ("You've met someone new 3 weeks in a row!")
  - Privacy: analytics only visible to user, never shared
- **Effort:** 2 weeks
- **RICE Score:** (1200 users × 5 impact × 70% confidence) / 2 = **2100**

---

### P1 (Should-Have for V3)

#### 14. Friend Discovery / New Friend Matching

- **Description:** Integrate with friend-finding platforms (Bumble BFF, Timeleft, Meetup) or build native matching
- **User Value:** Helps users expand social circles, not just maintain existing friendships
- **Requirements:**
  - Partnership discussions with Bumble BFF, Timeleft (affiliate program?)
  - Alternatively: native "find friends" based on activity preferences + location
  - Match users with similar availability patterns + interests
- **Effort:** 6 weeks (partnerships) or 12 weeks (native matching)
- **RICE Score:** (500 new users × 8 impact × 40% confidence) / 6 = **267**

#### 15. Activity Booking Integrations

- **Description:** Book reservations directly from app (OpenTable, Resy, Eventbrite)
- **User Value:** One-click "book a table" when confirming dinner plans
- **Requirements:**
  - API partnerships with booking platforms
  - In-app booking flow (or deep links to external apps)
  - Revenue share: potential commission on bookings
- **Effort:** 4 weeks per integration
- **RICE Score:** (600 users × 6 impact × 50% confidence) / 4 = **450**

#### 16. Shared Wishlists / "Want to Try" Lists

- **Description:** Users and friends curate lists of restaurants, activities, events to do together
- **User Value:** Solves "what should we do?" problem; builds anticipation
- **Requirements:**
  - Wishlist creation (add places/activities)
  - Share with specific friends
  - When scheduling, suggest items from shared wishlist
  - Mark as "done" after meetup
- **Effort:** 3 weeks
- **RICE Score:** (700 users × 6 impact × 70% confidence) / 3 = **980**

---

### P2 (Nice-to-Have for V3)

#### 17. Group Video Call Integration (Zoom/Google Meet Links)

- **Description:** Generate video call links for virtual hangouts
- **User Value:** Supports remote friendships
- **Requirements:**
  - Zoom/Google Meet API integration
  - Auto-generate link when scheduling virtual hangout
  - Calendar event includes link
- **Effort:** 2 weeks
- **RICE Score:** (400 users × 5 impact × 60% confidence) / 2 = **600**

#### 18. Gift Reminders & Occasion Tracking

- **Description:** Track birthdays, anniversaries, and auto-suggest hangouts around those dates
- **User Value:** Helps users be thoughtful friends
- **Requirements:**
  - Friend profile includes birthday, anniversary, etc.
  - Remind 1–2 weeks before: *"Alex's birthday is coming up—schedule a celebration?"*
  - Optional: gift idea links (affiliate revenue)
- **Effort:** 2 weeks
- **RICE Score:** (500 users × 4 impact × 70% confidence) / 2 = **700**

#### 19. Karma / Streak Gamification

- **Description:** Reward users for consistent social activity (badges, streaks, leaderboards)
- **User Value:** Fun motivation to stay connected
- **Requirements:**
  - Track streaks ("Met someone 4 weeks in a row!")
  - Badges for milestones (10 meetups, 5 friends connected, etc.)
  - Optional: leaderboard among friend groups (opt-in)
- **Effort:** 2 weeks
- **RICE Score:** (800 users × 3 impact × 50% confidence) / 2 = **600**

#### 20. Integration with Existing Social Apps (Low-Code)

- **Description:** Simple OAuth connections to Strava, Beli, Mezzanine to see mutual connections
- **User Value:** Discover which friends use same platforms
- **Requirements:**
  - OAuth with read-only access to friends list
  - Show *"You and Sarah both use Strava—follow each other?"* prompt
  - No deep integration, just friend discovery
  - Strong privacy controls to avoid stalking concerns
- **Effort:** 3 weeks per platform
- **RICE Score:** (300 users × 5 impact × 40% confidence) / 3 = **200**

---

## Up Next: New Event Source Integrations

> Eventbrite, Meetup, and NYC Open Data backend functions + frontend support have been implemented and deployed. The following steps remain to fully activate these sources:

### Already Done
- **Backend:** `searchEventbrite()`, `searchMeetup()`, `searchNYCOpenData()` functions added to `functions/src/index.ts`
- **Wired in:** All 3 endpoints (`/events/discover`, `/events/search`, `/events/match`) now query 5 sources in parallel
- **Frontend:** Source badges (Eventbrite = orange, Meetup = red, NYC Free = green) and dynamic source counts
- **DB migration:** `saved_events.source` CHECK constraint updated to allow `'eventbrite' | 'meetup' | 'nyc_open_data'`

### Still Needs
1. **Obtain API keys and set as Firebase secrets:**
   - `EVENTBRITE_API_KEY` — sign up at [eventbrite.com/platform](https://www.eventbrite.com/platform)
   - `MEETUP_API_KEY` — apply at [meetup.com/api](https://www.meetup.com/api)
   - `NYC_OPEN_DATA_APP_TOKEN` — (optional, raises rate limits) register at [data.cityofnewyork.us](https://data.cityofnewyork.us)
2. **Run the DB migration** (`migrations/add_new_event_sources.sql`) against Supabase
3. **Test each source end-to-end** with real API keys — verify events appear, save correctly, and match with friend availability
4. **Consider adding autocomplete suggestions** for the new sources (currently only SeatGeek/Ticketmaster have autocomplete)

### Other APIs Evaluated (Not Integrated)
- **Partiful** — No public API; events are private/invite-only
- **PredictHQ** — Aggregates 1000+ sources; good for enrichment later (paid)
- **Bandsintown** — Strong for concert/music discovery; free API
- **Yelp Events** — Local events via Fusion API; free tier available
- **Google Events (SerpAPI)** — Broad but paid wrapper

---

## Up Next: Security & Privacy Hardening

> Complete before broader launch / user growth

- **Encrypt OAuth/CalDAV credentials at rest:** Google `access_token`, `refresh_token`, and Apple `caldav_password` are stored in plaintext in the `users` table. Use Supabase Vault (`pgsodium`) or `pgcrypto` with a server-side key (stored as a Firebase Functions secret) to encrypt these columns. If the DB is ever breached, tokens would be useless without the encryption key. See the instructions in the conversation where RLS was enabled for implementation details.

---

## Icebox / Research Ideas (No Timeline)

> Explore these if user research validates demand

- **Post-meetup rating/log nudge:** After a confirmed meetup's end time passes, send a notification prompting users to rate the hangout and log activity details (type, duration, sentiment). This would feed the AI scoring engine with more data and improve future suggestions. Implement if user feedback indicates interest in tracking meetup quality.
- **AI-powered conversation starters:** Suggest topics based on shared interests
- **Expense splitting:** Built-in Venmo/PayPal for shared costs
- **Photos & memories:** Add photos to past meetups (like a private social network)
- **Public events discovery:** Surface local events (concerts, festivals) and invite friends
- **Transportation coordination:** Rideshare links or carpool matching for meetups
- **Meal planning:** For dinner hangouts, suggest recipes or meal kits
- **Habit tracking for friends:** "We said we'd hike monthly—let's book the next one!"
