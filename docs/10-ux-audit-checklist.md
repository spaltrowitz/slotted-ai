# Slotted — UX & Quality Audit Checklist

| Field | Value |
|---|---|
| **Version** | 1.0 |
| **Date** | February 15, 2026 |
| **Purpose** | Structured checklist for evaluating the app's user experience, visual design, functionality, performance, and technical quality before expanding beyond private beta |
| **How to use** | Walk through each section with the app open. Mark each item ✅ Pass / ⚠️ Needs work / ❌ Failing. Add notes in the right column. |

---

## 1. First Impressions & Landing Page

The landing page is often the only chance to convert a visitor. These checks should be done with someone who has **never** seen the app.

| # | Check | Status | Notes |
|---|---|---|---|
| 1.1 | Can a stranger articulate what Slotted does within 5 seconds of seeing the landing page? | | |
| 1.2 | Is the primary value proposition visible above the fold (no scrolling required)? | | |
| 1.3 | Is there a clear, single primary call-to-action (e.g., "Get Started" or "Sign in with Google")? | | |
| 1.4 | Does the page load in under 3 seconds on a mobile connection? | | |
| 1.5 | Does the page work without JavaScript enabled (graceful degradation)? | | |
| 1.6 | Are the two value prop sections (local + long-distance) clear and scannable? | | |
| 1.7 | Is there social proof or a trust signal (beta user count, testimonial, security mention)? | | |

---

## 2. Navigation & Information Architecture

| # | Check | Status | Notes |
|---|---|---|---|
| 2.1 | Can a new user find all major sections (Dashboard, Friends, Events, Notifications, Settings) without guidance? | | |
| 2.2 | Is the current page/tab clearly indicated in the nav? | | |
| 2.3 | Does the back button work as expected on every page? | | |
| 2.4 | Are there any dead-end pages (no clear next action or way back)? | | |
| 2.5 | Is the navigation consistent between desktop and mobile views? | | |
| 2.6 | Can users complete the core loop (add friend → find times → propose hangout) in ≤5 taps/clicks? | | |

---

## 3. Visual Design & Consistency

| # | Check | Status | Notes |
|---|---|---|---|
| 3.1 | Is the color scheme consistent across all pages (Slotted design tokens)? | | |
| 3.2 | Do all interactive elements (buttons, links, toggles) have consistent styling? | | |
| 3.3 | Is there sufficient color contrast for text readability (WCAG AA: 4.5:1 for body text, 3:1 for large text)? | | |
| 3.4 | Are fonts readable at all screen sizes without zooming? | | |
| 3.5 | Does the UI feel cluttered on any page? (Dashboard and Settings are most at risk) | | |
| 3.6 | Are icons meaningful and consistent (or do they require labels to understand)? | | |
| 3.7 | Is whitespace used effectively to group related elements? | | |
| 3.8 | Do modals/drawers have clear close mechanisms? | | |

---

## 4. Onboarding Flow

| # | Check | Status | Notes |
|---|---|---|---|
| 4.1 | Can a new user complete onboarding in under 2 minutes? | | |
| 4.2 | Is each onboarding question clear without needing the "Why we ask" tooltip? | | |
| 4.3 | Can users skip/defer calendar connection without feeling punished? | | |
| 4.4 | Does the Social Battery explanation make sense to someone hearing the concept for the first time? | | |
| 4.5 | Is progress visible during onboarding (step indicators)? | | |
| 4.6 | After onboarding, does the user land somewhere useful (not an empty dashboard)? | | |
| 4.7 | Is there a clear prompt to add friends immediately after onboarding? | | |

---

## 5. Core Feature Quality

### 5a. Calendar Sync

| # | Check | Status | Notes |
|---|---|---|---|
| 5a.1 | Does Google Calendar connect in one tap (OAuth flow)? | | |
| 5a.2 | Is sync status clearly visible in Settings? | | |
| 5a.3 | Does the sync indicator update when a calendar event changes? | | |
| 5a.4 | Can users disconnect their calendar easily? | | |
| 5a.5 | Does manual availability entry work as a clear fallback? | | |
| 5a.6 | Is the privacy messaging ("we only see free/busy") visible at the moment of calendar connection? | | |

### 5b. Friend Management

| # | Check | Status | Notes |
|---|---|---|---|
| 5b.1 | Can users send an invite link in under 3 taps? | | |
| 5b.2 | Do the share buttons (Text / Email / Copy link) work on all platforms? | | |
| 5b.3 | Is the friend request acceptance flow clear from the recipient's perspective? | | |
| 5b.4 | Are local vs. long-distance friends visually distinct? | | |
| 5b.5 | Does the friend selection → floating action bar flow feel natural? | | |
| 5b.6 | Can users manage friend groups (create, edit, delete) without confusion? | | |

### 5c. Availability Matching & Scheduling

| # | Check | Status | Notes |
|---|---|---|---|
| 5c.1 | Do AI-suggested times appear in under 2 seconds? | | |
| 5c.2 | Are suggestions obviously ranked (best time first)? | | |
| 5c.3 | Can users propose a hangout in one tap from a suggested time? | | |
| 5c.4 | Is the "Accept / Maybe / Not this time" flow clear and low-friction for the recipient? | | |
| 5c.5 | Does group availability matching (2+ friends) work and display clearly? | | |
| 5c.6 | Can users propose a custom time (not just AI suggestions)? | | |
| 5c.7 | Are the AI's suggestions reasonable? (Test: would a human suggest the same time?) | | |

### 5d. Notifications

| # | Check | Status | Notes |
|---|---|---|---|
| 5d.1 | Do push notifications arrive within 30 seconds of the triggering action? | | |
| 5d.2 | Is the push notification permission prompt well-timed (not on first page load)? | | |
| 5d.3 | Does the in-app notification inbox show all notification types clearly? | | |
| 5d.4 | Can users act on notifications directly from the inbox (accept/decline without navigation)? | | |
| 5d.5 | Is the welcome notification received exactly once (not on every login)? | | |

### 5e. Events & Discovery

| # | Check | Status | Notes |
|---|---|---|---|
| 5e.1 | Does event search return relevant results for the user's city? | | |
| 5e.2 | Are event categories useful and filterable? | | |
| 5e.3 | Does sharing an event with a friend feel lightweight (not cumbersome)? | | |
| 5e.4 | Is event deduplication working (no duplicate listings from SeatGeek + Ticketmaster)? | | |

### 5f. Dashboard

| # | Check | Status | Notes |
|---|---|---|---|
| 5f.1 | Does the "Today at a Glance" summary line read naturally and accurately? | | |
| 5f.2 | Is the Upcoming section useful (shows real upcoming hangouts, hides declined)? | | |
| 5f.3 | Does the calendar toggle (Week/Month/Agenda) persist across sessions? | | |
| 5f.4 | Is the "People to See" avatar row scannable (not overwhelming)? | | |
| 5f.5 | Does the Activity Feed show useful, actionable information? | | |
| 5f.6 | Is hangout logging intuitive (date, friends, activity, rating)? | | |
| 5f.7 | Does the dashboard feel useful on first visit (even with no data yet)? | | |

---

## 6. Mobile Responsiveness

| # | Check | Status | Notes |
|---|---|---|---|
| 6.1 | Does every page render correctly on an iPhone SE (smallest common screen)? | | |
| 6.2 | Does every page render correctly on a standard Android phone (e.g., Pixel 7)? | | |
| 6.3 | Are touch targets at least 44×44px (Apple HIG) / 48×48dp (Material)? | | |
| 6.4 | Is scrolling smooth and predictable (no janky or stuck scroll)? | | |
| 6.5 | Do modals and dropdowns fit within mobile viewports? | | |
| 6.6 | Does the keyboard not obscure input fields when typing? | | |
| 6.7 | Does the PWA install prompt appear and work on iOS? | | |
| 6.8 | Does the PWA install prompt appear and work on Android? | | |
| 6.9 | Does the installed PWA feel native (proper status bar, no browser chrome)? | | |

---

## 7. Performance

| # | Check | Status | Notes |
|---|---|---|---|
| 7.1 | Lighthouse Performance score ≥80? | | |
| 7.2 | Lighthouse Accessibility score ≥90? | | |
| 7.3 | Lighthouse Best Practices score ≥90? | | |
| 7.4 | First Contentful Paint under 1.5s? | | |
| 7.5 | Largest Contentful Paint under 2.5s? | | |
| 7.6 | No layout shift after initial load (CLS < 0.1)? | | |
| 7.7 | API calls return in under 500ms (check Network tab)? | | |
| 7.8 | Are images and assets properly optimized/compressed? | | |

---

## 8. Error Handling & Edge Cases

| # | Check | Status | Notes |
|---|---|---|---|
| 8.1 | What happens if Google OAuth is denied/cancelled? (Should return to login gracefully) | | |
| 8.2 | What happens if calendar sync fails? (Should show clear error, not silent failure) | | |
| 8.3 | What happens with 0 friends added? (Should guide to invite, not show empty state with no action) | | |
| 8.4 | What happens if both users have zero mutual availability? (Should say so clearly, not show nothing) | | |
| 8.5 | What happens if push notification permission is denied? (Should degrade gracefully) | | |
| 8.6 | What happens on network disconnection? (Offline state handling) | | |
| 8.7 | Are there any console errors visible in browser dev tools during normal usage? | | |
| 8.8 | What happens if a user clicks the invite link but already has an account? | | |

---

## 9. Technical Quality (Developer Check)

| # | Check | Status | Notes |
|---|---|---|---|
| 9.1 | Is HTTPS enforced (no mixed content warnings)? | | |
| 9.2 | Is the service worker registered and functional (check Application tab)? | | |
| 9.3 | Is Firebase Hosting configured with proper caching headers? | | |
| 9.4 | Are environment variables / API keys properly secured (not exposed in client bundle)? | | |
| 9.5 | Does the app pass `npx tsc --noEmit` with no type errors? | | |
| 9.6 | Are Supabase Row-Level Security policies in place for all tables? | | |
| 9.7 | Is rate limiting configured on Firebase Functions? | | |

---

## 10. Content & Copy

| # | Check | Status | Notes |
|---|---|---|---|
| 10.1 | Is all user-facing copy free of placeholder text ("Lorem ipsum", "[App Name]", "TODO")? | | |
| 10.2 | Is the tone consistently warm and casual (not corporate or robotic)? | | |
| 10.3 | Are error messages human-readable (not technical codes)? | | |
| 10.4 | Is the Social Battery concept explained where it first appears? | | |
| 10.5 | Are empty states helpful (tell the user what to do next, not just "Nothing here")? | | |
| 10.6 | Is the privacy messaging present at key trust moments (calendar connect, friend invite)? | | |

---

## How to Run This Audit

1. **Recruit 2–3 people** who have never seen Slotted (not beta testers — fresh eyes)
2. **Screen record their first session** (with permission) — watch where they hesitate, tap wrong things, or look confused
3. **Walk through this checklist yourself** on both desktop and mobile
4. **Run Lighthouse** in Chrome DevTools (Incognito mode, mobile simulation) and record scores
5. **Check the browser console** for errors during a full walkthrough of every page
6. **Prioritize fixes:** ❌ items first, then ⚠️ items that affect the core scheduling loop, then everything else
