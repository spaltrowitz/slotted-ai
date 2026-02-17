# Beta Tester Feedback

Ongoing feedback log from beta testers. Updated as new sessions happen.

---

## Themes

### Tamer — "Show me *why* before you ask me *what*"
Tamer's feedback is about **onboarding clarity and purpose**. He was willing to answer questions but needed to understand the payoff upfront. Users will tolerate setup friction if the value exchange is obvious — but a long questionnaire with no framing feels like a quiz, not a setup flow.

### Darren — "Let me tell you who I am so you can help me better"
Darren's feedback is about **personalization and inclusive language**. He wanted more nuanced preference controls (social goal direction, hangout lengths) and suggested broadening from "friends" to "friends and family." He also mentioned using it for taped interviews, but that's out of scope — Slotted is for people you want to *recurringly* see, not one-off scheduling (that's Calendly's lane).

### Emma — "I love the idea, but my calendar is a mess"
Emma's feedback is about the **cold start problem for non-calendar-native users**. She doesn't maintain accurate calendar data, so the core value prop (finding overlapping free time) breaks down for her. But the concept still resonates — especially for **group coordination** where the pain of texting back and forth is high enough to justify a tool. She's the user who needs Slotted to work *without* perfect calendar hygiene.

---

## Tamer

**Date:** February 2026

- The onboarding flow felt too long and he didn't know where it was going with all the questions initially. He realized it was to set default meeting times, but the purpose wasn't clear upfront.
- Follow-up: When asked if a single question + settings would be better, he suggested adding a short blurb explaining *why* each question is being asked. E.g. "We'll use this to prioritize your availability" for preferred times, or "This will be the default time for your meeting slots" for duration. The issue wasn't the number of questions per se — it was the lack of context for each one.

**Actions taken:**
- Trimmed onboarding from 8 steps → 2 steps (calendar connect + preferred times)
- Moved social frequency, social goal, hangout/call duration, personal time, and trip buffer to Settings
- Added explanatory subtitle on the preferred times step ("this helps Slotted suggest the best times")

### Tamer — Follow-up (February 2026)

- **Duplicate push notifications:** Received 4 push notifications within the same minute when Shari declined a meetup: 2× "Shari Paltrowitz can't make it" and 2× "Shari Paltrowitz declined your invitation." Should only receive 1 notification total (the "can't make it" version).
- **Duplicate in-app notifications:** Also saw duplicate confirmation notifications in the Inbox tab.

**Root cause found:**
1. The RSVP endpoint was sending TWO different notifications on decline — a generic "declined your invite" to the creator AND a separate "can't make it" to all participants (including the creator). These are redundant.
2. No deduplication existed in the notification system — if the same notification type was created twice for the same meetup within seconds, both were stored and pushed.

**Actions taken:**
- Fixed the RSVP decline flow: the generic "X declined your invite" notification is now skipped for declines (handled by the more specific "X can't make it" message instead)
- Added 60-second deduplication to `createNotification()`: if a notification with the same type + user + relatedId was created within the last 60 seconds, it's skipped

### Tamer — Follow-up #2 (February 2026)

- **Why doesn't it auto-add to my Google Calendar?** After the other person accepts, it should just appear on his calendar automatically — not require clicking "Add to Calendar" and opening a new tab. Since Slotted already has write access to his Google Calendar, this should be seamless.

**Analysis:** This is a great UX catch. The manual "Add to Calendar" flow adds friction at the moment of highest excitement (your friend just accepted!). Since we already have calendar write access via OAuth, auto-adding is straightforward.

**Actions taken:**
- When the **creator books** a meetup, it's auto-added to their Google Calendar immediately (background, non-blocking)
- When a meetup is **confirmed** (all participants accepted), it's auto-added to **every participant's** Google Calendar
- The `autoAddToGoogleCalendar` helper checks for duplicates (won't re-add if `google_event_id` already exists on the participant row)
- The manual "Add to Calendar" button still exists as a fallback for users without Google Calendar connected, or for adding to a specific non-primary calendar

---

## Darren

**Date:** February 2026

- Suggested adding 1–2 more onboarding questions for customization: "Are you trying to increase, decrease, or maintain your current social activity?" and preferred hangout lengths.
- Suggested making language more inclusive — "friends and family" not just "friends."
- Loves the concept. Sees scale potential: sponsorships, integrated advertising from entertainment, food, and partnerships.
- Also mentioned wanting to use it for taped interviews — but that's a one-off scheduling problem (Calendly territory), not Slotted's focus. Slotted is for people you want to *recurringly* see.

**Actions taken:**
- Added social goal (increase/maintain/decrease) to Settings
- Added default hangout duration to Settings
- Updated language to be more inclusive (friends & family)

---

## Emma

**Date:** February 2026

- Calendar usage: Doesn't actively manage her Google Calendar — mostly just receives calendar invites or downloads from events. Uses Apple Calendar (iCal) but admits she slots things in "randomly and not at the right times." Uses Outlook for work.
- Liked the concept overall: "I like where you're going with this."
- Sees potential for scale: "I think you can SCALE THIS! And bring it to orgs that don't use Gmail or Outlook."
- Manual availability entry (weekly tap-to-block): Probably wouldn't do it weekly — "it's an extra step, I'd rather just text." BUT would use it for coordinating larger group hangs (e.g. 10 people going to a show), similar to how she uses Doodle today.
- Key insight: For users who don't keep their calendar accurate, Slotted's calendar-based approach has a cold start problem. The value prop clicks more for **group coordination** than 1:1 scheduling for this persona.

---

## Tom (via Mindy)

**Date:** February 2026
**Context:** Mindy showed Tom the Slotted homepage at a Lunar New Year dinner. Tom is a parent.

- Immediate reaction: "Could be very promising because it does solve a user need."
- **Key question: Has the parent/family use case been considered?** Specifically, parents coordinating playdates or hangouts with other families. Currently it's too much planning to look across 4 different people's calendars (2 parents × 2 families).
- Noted that **privacy settings for families** would be important — parents sharing calendars with other families need different controls than friends sharing with friends.

**Analysis:**

This directly validates the **Couple Mode / Linked Scheduling Units** feature already in the [V2-V3 backlog (item 7b)](../docs/04-backlog-v2-v3.md). Tom's use case is the specific instance Shari had identified: couples/families as scheduling units.

The parent/playdate angle is a compelling **wedge market** because:
1. **Pain is acute and recurring** — playdates happen weekly, across 4+ calendars, with higher stakes (kids' schedules, nap times, activities)
2. **Group coordination is the norm** — it's rarely 1:1, almost always "Can the Smiths and the Johnsons do Saturday afternoon?" which is the exact N-way overlap problem Slotted already solves
3. **Calendar hygiene is high** — parents tend to keep calendars accurate because they're juggling kids' activities, school, sports, etc. This avoids Emma's cold-start problem
4. **Word-of-mouth is built in** — parent communities (school, daycare, neighborhood) are tight referral networks

**What would need to change for this use case:**
- Couple Mode (mutual opt-in linking, merged availability as one unit)
- Privacy controls: ability to share "busy/free" without event details, per-group visibility settings
- Language: "family" / "household" framing alongside "friends"
- Possible kid-aware scheduling: integration with kids' activity calendars, nap/bedtime windows as auto-blocked time

**Actions taken:**
- Recorded feedback
- No code changes needed yet — this validates V2 Couple Mode priority

---
