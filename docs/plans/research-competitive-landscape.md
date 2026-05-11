# Research: Competitive Landscape — Does Slotted Have a Unique Position?

**Date:** 2026-05-11
**Author:** Research pass via Copilot CLI
**Question:** Are there apps/webapps already on the market that do what Slotted does? Does Slotted have distinguishing features?

---

## TL;DR

**No single app on the market combines what Slotted does.** The market is split across three adjacent categories, each missing a core piece of Slotted's value prop. The closest direct competitor is **Howbout**; the closest *philosophical* competitor is **PlanPop**. Neither combines AI-ranked free/busy scheduling with friendship-cadence nudges, a private social battery, and the soft-social UX Slotted enforces.

Slotted's defensible wedge is the **intersection** of four things no competitor bundles:
1. AI ranking over real calendar free/busy (not polls)
2. Private signals (Social Battery, busyness) that influence ranking but are never displayed to friends
3. Friendship-cadence tracking & drift nudges
4. Soft social grammar ("Not this time," "Maybe," no decline/❌, no visible status badges)

---

## Slotted's Core Feature Set (for comparison)

Derived from `docs/06-mvp-current-state.md`, `docs/03-prd-mvp-v1.md`, `docs/09-business-plan.md`:

1. Google Calendar free/busy sync (real-time webhooks)
2. AI scoring engine that ranks meeting slots by mutual availability + learned preferences
3. **Social Battery** — private input (Open / Ask Me / Recharging), never shown to friends
4. **Friend-cadence tracking** — nudges before friendships drift
5. Group scheduling (auto-surfaced when 2+ friends selected)
6. Long-distance / timezone-aware support (call windows)
7. Event discovery as hangout inspiration
8. **Privacy-first**: no exposed event details, no free-block counts, no calendar sync status of friends
9. **Soft dynamics**: "Not this time" / "Maybe" instead of ❌ Decline; no group chat layer
10. PWA — install anywhere, no app-store gatekeeping

---

## Competitive Map — Four Categories

### Category A: Friend-First Shared Calendar Apps (closest direct competitors)

| App | What it does | Where Slotted differs |
|---|---|---|
| **Howbout** (iOS/Android) | Friend-focused shared calendar; you choose what availability to share; in-app chat; create plans | **Sharing-based, not AI-ranked.** Friends see your availability blocks directly. No social battery, no cadence nudges, no AI suggestion of optimal times. More like a "social Google Calendar." |
| **PlanPop** | Start with an idea (no date), schedule when ready; couples/small groups | No calendar sync, no AI ranking — it's a lightweight idea-park-and-poll. Closest in *softness* but lacks the calendar intelligence. |
| **ALL IN: Social Calendar** | Plans + polls + RSVP statuses ("I'm In", "Maybe") + chat | Poll/chat-driven, no calendar sync, no AI ranking. The "Maybe" status echoes Slotted's softness but it's an RSVP signal, not a scheduling input. |
| **PalsSocial** | Group hangout planning + venue discovery + tasks | More like a hangout *project manager* than a scheduler. No AI free/busy ranking. |
| **TimeTree** | Multi-calendar sharing + group chat | Calendar-sharing tool, not a scheduler. Built for families/coordination, no AI, no friend-cadence layer. |
| **Cupla** | Couples calendar sync | Two-person only, no AI ranking, no friend-cadence concept. |

**Verdict:** This is the most crowded adjacent space, but every entry is either (a) a sharing tool that exposes raw availability or (b) a poll/RSVP tool. **None do AI ranking over private free/busy data.**

---

### Category B: AI Calendar Assistants (work-focused, but technically capable)

| App | What it does | Why it's not Slotted |
|---|---|---|
| **Reclaim.ai** | Smart scheduling + habit blocks; protects focus time; finds shared free windows | Work-first. Pricing & UX are for teams. Treats "hangout" as a habit, not a relationship. No friend graph, no cadence nudges. |
| **Motion** | AI auto-planner for tasks + meetings (~$20-29/mo) | Productivity tool. Tasks > friendships. |
| **Vimcal** | Fast calendar UI + free-time finder | Pure UI play. No social layer. |
| **Clockwise** | Team focus-time optimizer | Built for org-wide team calendars, not friend graphs. |
| **Cal.com / Calendly** | Booking links | One-to-many bookings, no friend graph, no cadence. |
| **Ayari / Lindy / Carly / Clara** | Conversational AI scheduling agents | Email/chat negotiation agents — work-meeting framing, not relationship maintenance. |

**Verdict:** These tools *could* be repurposed for friend scheduling but **none are designed for it**. Pricing, language, and feature priorities (focus time, deep work, meeting bloat) all signal "work." Their UX would feel cold and transactional for "let's grab coffee."

---

### Category C: Personal CRMs / Keep-in-Touch Apps

| App | What it does | Why it's not Slotted |
|---|---|---|
| **Dex** | Cross-platform people tracker + reminders | No calendar sync, no scheduling — just reminders & notes. Business-flavored. |
| **Clay** | AI-powered personal CRM | More business networking than friendship maintenance. |
| **Monaru** | AI suggestions for staying in touch | Reminder-driven, no calendar sync, no group scheduling. |
| **Fabriq** | Priority wheel + check-in nudges | Same — reminder app, not a scheduler. |
| **UpHabit / Covve / Garden** | Personal CRM with notes/news | Contact-management framing. |
| **CatchUp / Up Ahead / Soonly / Social Compass / Serenity** | Various friendship-cadence trackers with reminders, sparks, timelines | All solve **half** of Slotted (the "haven't talked in a while" nudge) but none can actually schedule the meetup. They tell you to reach out — Slotted finds the time *and* gets it on the calendar. |

**Verdict:** This is the category that most validates Slotted's *cadence* feature, but every app here stops at "send a reminder." They hand the user back to text-message coordination. Slotted closes the loop.

---

### Category D: Poll-Based Group Schedulers

| App | What it does | Why it's not Slotted |
|---|---|---|
| **Doodle, When2meet, Rallly, TallyCal, Crab Fit, WhenAvailable, Whenly, Framadate, StrawPoll, Groop** | One-off polls to find time that works for a group | Manual time-proposal model — exactly the friction Slotted's PRD calls out as the problem. No calendar sync (or one-direction read), no relationship persistence, no recurring/long-tail friendship layer. |

**Verdict:** These are the "before" state Slotted is trying to replace. They're explicitly called out in `docs/09-business-plan.md` as the existing friction.

---

## Distinguishing Features — What ONLY Slotted Has

These are the features that, in combination, no competitor offers:

| Feature | Closest competitor | Gap |
|---|---|---|
| **AI ranking of slots over real free/busy from multiple friends' calendars** | Reclaim, Motion | Competitors do this for *work* contexts, not friend graphs with social signals. |
| **Social Battery as a private ranking input** | None | Unique. Nobody treats "I'm low energy this week" as a scheduling signal that's invisible to others. |
| **Friendship-cadence drift nudges + ability to act on them** | Dex/Monaru/Fabriq nudge; Howbout schedules | Slotted is the only one that *combines* the nudge with the calendar action. |
| **Privacy-first scheduling** (friends never see your battery, free-block counts, or calendar sync status) | Howbout exposes availability; Calendly shows free slots | Genuinely differentiated UX choice. |
| **Soft social grammar** ("Not this time," "Maybe," no ❌) | ALL IN has "Maybe" RSVP | Slotted threads softness through the *entire* product, not just one button. |
| **Long-distance / timezone-aware call windows** as a first-class friend type | Generic timezone widgets | Most friend apps assume local hangouts. |
| **PWA-first delivery** | Most competitors are native | Removes app-store friction, but easily copied. |

---

## Risks to Slotted's Position

1. **Howbout could add AI ranking.** It already has the friend graph and calendar sync. If they shipped an "AI suggested times" layer, the gap would narrow significantly. They have years of user growth.
2. **Reclaim/Motion could add a "personal" mode.** They already have the calendar AI; bolting on a friend graph is the easier direction.
3. **iMessage/Apple could ship native "find a time with friends."** Apple has the calendar, contacts, and trust. This is the single largest existential risk.
4. **Personal CRM apps (Dex, Monaru) could add calendar scheduling.** They already own the relationship layer.
5. **The "Social Battery" concept is uncopyrightable** — easy to clone the label, hard to clone the depth of how it influences ranking. Slotted needs to make this feature *demonstrably* smart.

---

## Strategic Implications

### Where Slotted is genuinely defensible:
- **Privacy posture** — "we never show your friends your battery / your busyness / your sync status" is a *brand* commitment that's hard to retrofit. Howbout's whole model is sharing availability, so they can't pivot without breaking their value prop.
- **The bundle** — any single competitor would need to add 3+ features to match. The integration of free/busy + cadence + social battery + soft UX is the moat.
- **Tone & language** — soft social grammar is a *taste* moat. Work-calendar apps speak in productivity verbs ("block," "schedule," "decline") and can't credibly switch.

### Where Slotted is exposed:
- **No network effect yet.** Howbout has years of users. Slotted needs friends-of-friends growth loops.
- **Cadence-tracking is a feature, not a product.** If a Dex/Monaru ships scheduling, they have the relationship data already.
- ~~Google Calendar dependency~~ **Resolved** — Google + Outlook (MS Graph) + Apple (CalDAV) all shipped. This is now a *strength*, not a gap. Most adjacent apps (Howbout being a notable exception) are single-provider or Google-leaning.

### Recommendations:
1. **Lead with privacy in marketing.** "Your friends never see your battery, your busy blocks, or your sync status" is a sharp differentiator nobody else can claim.
2. **Demo the AI ranking explicitly.** Show that Slotted picks a *better* time than Howbout's "here's everyone's blocks" view. This is the wedge against the friend-calendar category.
3. **Treat cadence nudges as a top-funnel acquisition feature.** That's the emotional hook (guilt-relief, "haven't seen X in 4 months") — it's also what 6+ standalone apps validate as a market.
4. **Watch Howbout closely.** They're the most likely to add AI ranking and would become a direct competitor overnight. Track their changelog.
5. **Consider an Apple/Outlook calendar story sooner than V2.** Google-only is fine for MVP, but the calendar-mixed friend group is the killer onboarding blocker.
   - **Update (2026-05-11):** Apple Calendar (CalDAV) and Outlook (Microsoft Graph) are already shipped. This makes Slotted one of the only friend-scheduling apps that supports a truly mixed-provider friend group out of the gate — a real differentiator vs. Howbout (Google + Apple/Outlook subscribe-only) and every poll tool.

---

## Bottom Line

**Slotted is not me-too.** The four-corner intersection (calendar AI + cadence + private battery + soft UX) is genuinely unoccupied. But the corners themselves are not — and a single well-funded entrant from any adjacent category (especially Howbout or Apple) could collapse the gap. The defensibility lives in the *bundle and the tone*, not in any one feature.
