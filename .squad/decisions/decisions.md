# Decisions — Slotted Product & Design

## Open Decisions (pending Shari)

### 2026-03-05 — UI Simplification via Apple Design Principles (Ty Lee)

**Date:** 2026-03-05  
**Author:** Ty Lee (UI Designer)  
**Status:** Proposed  
**Document:** `docs/plans/tylee-apple-design-review.md`

**Summary:** Reviewed Suki's product audit and Mai's strategy review through Apple design lens. Core diagnosis correct (state-aware progressive Dashboard). Agreed with 8/12 recommendations, adjusted 4.

**Approved (ship as stated):**
1. State-aware progressive Dashboard — show UI based on user stage
2. Kill Events page entirely (1683 lines for a different product)
3. Settings → 1 page with "Advanced" accordion collapsed
4. Zero onboarding (OAuth + calendar connect only)
5. Single-suggestion scheduling ("How about Saturday 2pm?")
6. Star rating for hangout logging (not 6-field form)
7. Hide Social Battery until 3+ hangouts
8. Remove score emojis (🔥👍🤔😐)

**Adjusted:**
1. **Notifications:** Kill the page, but keep a dropdown/sheet from bell icon (not inline banners only)
2. **Friend cards:** Strip metadata, convert to list rows instead of cards
3. **Help page:** Kill inline help, keep hidden /help accessible from Settings
4. **Emoji policy:** 13 → 8 emojis (🟢🟡🔴✅⏳⭐⚠️❤️)

**Additional Recommendations:**
- Define a 5-level type scale and enforce globally
- Reduce color palette: one accent color, everything else grayscale
- 4 bottom tabs → 3 (move Settings to header avatar)
- Empty state needs design attention: warm whitespace, illustration, single CTA
- State transitions should animate (friend joins, hangout booked = emotional moments)

**Impact:** Visual diet, not redesign. Features work, AI matching is clever. Visual layer drowning in non-earningpixels. Strip, then polish.

---

### 2025-07-25 — Notifications & Help Structure (Suki vs. Mai, escalated)

**Date:** 2025-07-25  
**Authors:** Suki (Designer) & Mai (Product Strategist)  
**Status:** Escalated — 3 points under review

**Point 1 — Notifications Structure**
- **Mai's position:** Remove Notifications page entirely; use inline banners only
- **Suki's position:** Kill the page BUT keep a lightweight dropdown/sheet for high-activity users (inline banners don't scale past 2–3 items)
- **Ty Lee review:** Aligns with Suki — dropdown/sheet from bell icon is the right balance

**Point 2 — Help Resources**
- **Mai's position:** Remove ALL help resources (inline, contextual, dedicated pages)
- **Suki's position:** Pragmatic middle ground — discoverable /help page from Settings + subtle "?" icon costs nothing, catches confused edge-case users
- **Ty Lee review:** Aligns with Suki — keep hidden /help accessible from Settings

**Point 3 — First-Time Scheduling Escape Hatch**
- **Mai's position:** Single suggestion with small "See other times" link
- **Suki's position:** Single suggestion is right, but escape hatch needs more visual weight (expandable section, not small link)
- **Ty Lee review:** Single suggestion is the right Day 1 UX (pending escape hatch visual weight decision)

**Decision required:** Shari to resolve notifications dropdown, help page, and escape hatch visual weight.

---

## Resolved Decisions

### 2025-07-25 — Groups Feature Removal

**Status:** RESOLVED — Remove from V1  
**Context:** Groups feature adds ~160 lines of UI but only provides "save friend selection" convenience. User feedback: "Groups feature isn't needed — selecting multiple friends already handles group scheduling."

### 2025-07-25 — Dashboard Calendar Removal

**Status:** RESOLVED — Remove from V1  
**Context:** User already has Google Calendar. Dashboard calendar doesn't enable core action (scheduling availability). Clutter for non-calendar-native users.

### 2025-07-25 — Events Page Removal

**Status:** RESOLVED — Remove from V1  
**Context:** 1683 lines, 4 tabs, dual-API search. This is a fully-featured event discovery app inside a scheduling app. Non-negotiable V2 deferral.

### 2025-07-25 — Emoji Reduction (13 unique emojis)

**Status:** RESOLVED — Reduce to 13 functional emojis  
**Approved set:** 🟢🟡🔴✅✓✕⭐⚠️❤️⏳  
**Context:** Applied 4-criteria test to all 100 unique emojis. Emoji + text label pair always fails. 87% unique reduction, 93% instance reduction.  
**Update (Ty Lee):** Further reduce 13 → 8 emojis for stricter compliance with Apple design minimalism.

### 2025-07-25 — Social Battery Visibility

**Status:** RESOLVED — Hide until 3+ hangouts  
**Context:** It's a power-user control. New users don't have enough data for it to be useful.

### 2025-07-25 — Hangout Logging Simplification

**Status:** RESOLVED — Star rating (not 6-field form)  
**Context:** 6-field form is excessive for early hangout logging. Star rating captures quality sentiment without friction.

### 2025-07-25 — Score Emojis Removal

**Status:** RESOLVED — Remove 🔥👍🤔😐  
**Context:** Creates decision fatigue. Score concept is Week 4 feature, not Day 1.

### 2025-07-25 — Friend Card Design

**Status:** RESOLVED — Strip to avatar + name + last seen  
**Context:** Interest badges are AI data (event ranking V2), not user data (scheduling V1). Sync status is noise.

### 2025-07-25 — Settings Consolidation

**Status:** RESOLVED — 4 tabs → 1 page with "Advanced" accordion  
**Context:** Single page with collapsible advanced section reduces cognitive load, removes duplicate navigation patterns (Avatar + Settings both go to Settings).

### 2025-07-25 — Navigation Consolidation

**Status:** RESOLVED — 4 nav items → 3; move Settings to header avatar  
**Context:** "Inbox" label mismatch with `/notifications` route addressed. Consolidation removes redundant nav items.

### 2026-03-05 — Progressive Dashboard (State-Aware)

**Status:** RESOLVED — Implement by user milestone  
**Context:** Root cause of "too busy" is rendering same 10+ sections for all users. Progressive disclosure by state (inviting → scheduling → maintaining) fixes at source.  
**Milestones:**
- Day 1 (0 friends): Single CTA "Invite a friend"
- Friends joined: Upcoming, Catch Up, Find times
- 3+ hangouts: Add Social Battery, Hangout Logging, Activity
- Power users: Advanced preferences, integrations

### 2026-03-05 — Zero Onboarding

**Status:** RESOLVED — OAuth + calendar connect only  
**Context:** Preferred times learned from behavior. Day 1: OAuth → Calendar → Invite → Friend joins → Single suggestion → Book (goal: <3 min).

### 2026-03-05 — Single-Suggestion Scheduling (Option C)

**Status:** RESOLVED — "How about Saturday 2pm?"  
**Context:** Mimics how friends actually propose times. Lists of 8 ranked slots are spreadsheet UX, not social UX.
