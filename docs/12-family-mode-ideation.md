# Family Mode — Product Ideation

**Date:** February 2026  
**Origin:** Beta tester feedback from Tom (via Mindy) — parents coordinating playdates across 4+ calendars  
**Builds on:** Backlog item 7b (Couple Mode / Linked Scheduling Units)

---

## The Problem

When families want to hang out with other families, coordination is brutally manual:

1. Parent A texts Parent C: "Are you guys free Saturday?"
2. Parent C checks their own calendar, then asks Partner D
3. Partner D says "I have a thing at 2, but morning works"
4. Parent C relays back to Parent A
5. Parent A checks with Partner B
6. Repeat until everyone gives up or accidentally triple-books

This is 4 calendars, 2-3 rounds of texting, and usually defaults to "let's just play it by ear" — which means it doesn't happen.

For parents coordinating **playdates**, it's even worse: add kids' activity schedules, nap windows, and school pickups into the mix.

---

## Core Concept: Households

A **Household** is a linked scheduling unit — 2 people who share a life and calendar. It's the atomic unit that replaces "individual" in family scheduling scenarios.

### How it differs from Groups

| | Group | Household |
|---|---|---|
| **Size** | 2–10 people | Exactly 2 people |
| **Calendar merge** | On-demand (query time) | Pre-computed (background) |
| **Identity** | "Shari's brunch crew" | "The Paltrowitzes" |
| **Invitability** | Select individual members | Invite as a single unit |
| **Persistence** | Casual, deletable | Deep link, unlinking is intentional |
| **Visibility** | Members see each other's free time | Partners see each other's full calendar (opt-in) |

---

## Feature Breakdown

### Phase 1: Household Linking (replaces "Couple Mode")

**What:** Two users can link as a Household. Their combined availability is pre-merged and cached.

**User flow:**
1. In Settings → "Create a Household" → enter partner's email
2. Partner gets a notification: "Shari wants to create a Household with you"
3. Partner accepts → both profiles now show "🏠 The Paltrowitzes" (editable name)
4. Each person's calendar stays private by default — only the merged busy/free overlay is shared

**What changes in the existing app:**

- **Friends page:** When someone views your profile, they see "Shari & Mike" as a unit. They can "Find times" with the household (checks both calendars) or with just one person.
- **Group creation:** When adding a friend who's in a household, a toggle appears: "Include [partner name] too?" — pre-checked by default.
- **Group overlap:** Households are resolved server-side. Selecting "The Paltrowitzes" = intersecting Shari's AND Mike's calendars, then treating that as one participant in the N-way overlap.
- **Booking:** When "The Paltrowitzes" accept a hangout, both people's calendars get the event.

**Data model additions:**
```sql
CREATE TABLE households (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,            -- "The Paltrowitzes"
  emoji           TEXT DEFAULT '🏠',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each user can belong to at most one household
ALTER TABLE users ADD COLUMN household_id UUID REFERENCES households(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN household_role TEXT DEFAULT 'member'; -- 'creator' | 'member'

-- Pre-computed merged availability for the household
CREATE TABLE household_availability (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'free'
);
```

**Performance impact:** Instead of 2 live calendar syncs per household at query time, availability is pre-computed whenever either partner's calendar changes. A "3 families on Saturday" query goes from 6 API calls + 6-way intersection → 0 API calls + 3-way intersection of cached slots.

---

### Phase 2: Family-Aware Scheduling

**What:** Scheduling intelligence that understands family rhythms.

**Features:**

#### Kid Schedules (Optional)
- Add kids' names and ages (no Slotted account needed — just metadata on the household)
- Mark recurring blocked times: "Soccer practice (Tues/Thu 4-5:30pm)", "Nap time (daily 1-3pm)"
- These auto-block on the household's merged availability
- UI: Simple list in Settings → Household → "Kids' schedules" with recurring time pickers

#### Smart Duration Defaults
- Family hangouts default to 2-3 hours (current group default)
- Playdate suggestions auto-set to 2 hours
- Dinner-with-families defaults to 3 hours
- These adapt per household based on logged hangout history

#### Weekend Priority
- Family scheduling heavily weights weekends and school breaks
- "Find times" for two households should prioritize: Saturday morning > Sunday morning > Friday evening > weekday evening
- Existing scoring algorithm already has weekend bonuses — just increase the weight when participants are households

---

### Phase 3: Privacy & Visibility Controls

This is Tom's specific callout and it matters.

**Levels of visibility (per-relationship):**

| Level | What they see | Use case |
|---|---|---|
| **Free/Busy only** (default) | Green/red blocks, no event names | Other families, acquaintances |
| **Event titles** | Can see what you're doing | Close friends |
| **Full detail** | Event names, locations, notes | Household partner only |

**Implementation:** Add a `visibility_level` column to the friendships table. The calendar events endpoint filters based on the viewer's relationship to the calendar owner.

**Household-specific privacy:**
- Each partner can see the other's full calendar (opt-in, can be turned off)
- External friends only ever see the merged household free/busy — never individual event details
- "Solo mode" toggle: temporarily remove yourself from household availability for solo hangouts ("I'm going to brunch with my friends, don't include Mike's calendar")

---

### Phase 4: Family Groups (Households in Groups)

**What:** Groups where the members are households, not individuals.

**Example:**  
"Weekend Families" group = The Paltrowitzes + The Cohens + The Becks

**How it works in the existing group UI:**
- When creating a group, friends who are in households show as "Shari & Mike 🏠" with a toggle
- Selecting the household adds both people's calendars to the group overlap
- The group members list shows: "🏠 The Paltrowitzes, 🏠 The Cohens, 🏠 The Becks"
- "Find times" for this group does a 3-way overlap (not 6-way), because households are pre-merged

**Booking flow:**
- "Book it" on a group time → all members of all households get the invite
- Each household can accept/decline as a unit (either partner can respond for both)
- Calendar event is created for all participants

---

## What Already Exists That We'd Reuse

| Existing Feature | How Family Mode Uses It |
|---|---|
| **Group overlap engine** | Households are just pre-computed "groups of 2" — the N-way intersection algorithm works unchanged |
| **Calendar sync pipeline** | Each person still syncs individually; household availability is a post-processing step |
| **Friend groups** | Family groups are groups where some members are households |
| **Social battery** | Households could share a "family social battery" — if one partner is recharging, the household is unavailable |
| **Travel buffer** | Apply the longer of the two partners' buffers |
| **Manual busy blocks** | Either partner can add blocks that affect household availability |
| **Notifications** | Both partners get notified when their household is invited somewhere |

---

## Phased Rollout Plan

| Phase | What ships | Effort | Unlocks |
|---|---|---|---|
| **1a** | Household linking (2 people, mutual opt-in) | 1 week | Partners see each other as a unit |
| **1b** | Pre-computed household availability | 1 week | Fast queries, household shown as one slot set |
| **1c** | "Find times with household" in Friends page | 3 days | Core use case: "When are the Smiths free?" |
| **2a** | Kid schedule blocks (recurring time blocker) | 3 days | Playdate-aware scheduling |
| **2b** | Household in group creation | 3 days | Family group dinners |
| **3** | Per-friendship visibility controls | 1 week | Privacy for family contexts |
| **4** | Family group scheduling (households as group units) | 1 week | "3 families on Saturday" in one tap |

**Total: ~5 weeks** from current state to full Family Mode.

---

## Go-to-Market Angle

**Positioning:** "Slotted for Families — stop texting, start hanging out"

**Wedge:** Target parent communities — school parent WhatsApp groups, daycare email lists, neighborhood Facebook groups. The pitch: "Finding a time for 2 families to get together shouldn't take 15 texts. Slotted checks everyone's calendars and finds when you're all free."

**Virality mechanism:** One parent invites another family → that family creates their household → they invite their friends → network grows by households (2 users per invite), not individuals.

---

## Open Questions

~~1. **Should households be limited to 2 people?** Starting with 2 is simpler but could feel exclusionary.~~  
**Decision:** No limit needed. Households can be any size.

~~2. **Can one person be in multiple households?** Co-parenting situations could require it.~~  
**Decision:** Not needed. One household per person. Co-parenting is out of scope.

~~3. **How do we handle the single parent case?** A household of 1 should still work.~~  
**Decision:** Yes — a household of 1 is valid. It's "me + my kids' schedules" as a scheduling unit.

~~4. **Should kids ever have their own accounts?**~~  
**Decision:** No. Kids are metadata on the household (names, ages, recurring schedule blocks), not users.
