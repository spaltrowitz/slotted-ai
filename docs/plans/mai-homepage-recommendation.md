# Product Recommendation: Multi-Friend Homepage Fix

**Author:** Mai (Product Strategist)  
**Date:** 2026-03-05  
**Problem:** Users with 10 friends see arbitrary single-friend homepage ("You and Mindy are connected! ❤️")  
**Status:** Recommendation

---

## Problem Analysis

### Current Stage System Breakdown

The `getUserStage()` logic in `userStage.ts` is:

```typescript
if (friendCount > 0 && completedHangoutCount === 0) return 'one-friend';
```

**This is wrong.** The stage is named `one-friend` but triggers for **any** user with friends who hasn't completed a hangout yet — whether they have 1 friend or 10 friends.

For Shari (10 friends, 0 completed hangouts):
- Stage calculates as: `'one-friend'` ❌
- Dashboard renders: `StageOneFriend` component
- Component picks: `friends[friends.length - 1]` (most recent connection = Mindy)
- User sees: **"You and Mindy are connected! ❤️ Ready to find time to hang out? → Find times with Mindy"**

This is **jarring and arbitrary** for someone with 10 friends. Why Mindy? The user has 9 other friends. The homepage should acknowledge the full network, not pick one person at random (or rather, by recency, which feels random to the user).

### Why This Stage Exists (and why it's misnamed)

Looking at the stage progression:
1. `no-calendar` → Connect calendar
2. `no-friends` → Invite first friend
3. `pending-invite` → Accept friend request
4. **`one-friend`** → Schedule first hangout
5. `has-hangouts` → Keep scheduling (1+ hangout, but not "active" yet)
6. `active-user` → Power user (3+ friends, 2+ completed hangouts)

The `one-friend` stage's **purpose** is: *guide user to book their first hangout*. The stage name assumes the user literally has one friend, but the logic doesn't enforce that. This is a **naming/logic mismatch**.

### Slotted's Product Principles (from custom instructions)

Before recommending a fix, let me ground in the principles:

1. **Privacy-first** — Never expose calendar details, battery, or activity to others
2. **Soft social dynamics** — No "decline" language, no ❌ for social actions, no pressure
3. **AI is invisible infrastructure** — Suggests and ranks, but user feels like they're choosing
4. **Reduce friction at moments of excitement** — Auto-add to calendar on acceptance
5. **No social pressure** — Don't show connection status, free slots, or anything that pressures action

---

## Recommendations

### Option A: "Pick someone to hang out with" (Recommended)

**What the homepage shows:**

```
┌─────────────────────────────────────────────┐
│ Who do you want to hang out with?          │
│                                             │
│ [avatar] [avatar] [avatar] [avatar] ...    │
│  Mindy    Sarah    Alex     Jordan         │
│                                             │
│ Tap anyone to find times together →        │
└─────────────────────────────────────────────┘
```

**Interaction:**
- Horizontal scrollable row of friend avatars (like current "People to See" on active-user dashboard)
- Tap any friend → navigates to `/friends?findTimes={friendId}` (same as current "Find times with Mindy" button)
- No ranking, no AI suggestions — just "here are your friends, pick one"

**What data is needed:**
- `friends` array (already fetched in DashboardPage)
- Friend display name + photo URL (already in FriendRecord type)

**Why this is right:**
- **Acknowledges the full network** — All 10 friends are visible, not just one arbitrary pick
- **User agency** — The user chooses who they want to see, not the app telling them "you should hang out with Mindy"
- **No social judgment** — Friends are presented in a flat grid (or sorted by last met, which is chronological/neutral)
- **One clear action** — "Tap someone" → you're in the scheduling flow
- **Scales gracefully** — Works whether you have 2 friends or 10 friends
- **Reduces friction** — Exactly one tap to enter the scheduling flow (same as current "Find times with Mindy →" button)

**Tradeoffs:**
- Still puts the burden on the user to pick a friend (no AI assist)
- Slightly less opinionated than "Here's who you should see this week"

---

### Option B: "People to catch up with" (AI-driven)

**What the homepage shows:**

```
┌─────────────────────────────────────────────┐
│ People to catch up with                     │
│                                             │
│ [avatar]         You last saw Sarah         │
│  Sarah           31 days ago                │
│                  → Find times together      │
│                                             │
│ [avatar]         You last saw Jordan        │
│  Jordan          18 days ago                │
│                  → Find times together      │
│                                             │
│ See all friends →                           │
└─────────────────────────────────────────────┘
```

**Interaction:**
- Show 2–3 friends ranked by: (1) longest time since last hangout, or (2) AI-suggested priority
- Each friend has a one-tap "Find times together" button
- "See all friends →" link goes to `/friends` page

**What data is needed:**
- `friends` array with `last_met` dates (already in schema)
- Optional: AI scoring (could be as simple as days-since-last-met, or more complex)

**Why this is right:**
- **AI-assisted priority** — The app suggests who you're overdue to see (invisible infrastructure, but helpful)
- **No social pressure** — The language is "catch up with" (positive, not "you should see")
- **Actionable** — Each friend has a clear next step (Find times)
- **Escape hatch** — "See all friends" if the suggestions aren't right
- **Progressive disclosure** — Shows 2–3 people, not overwhelming with 10 avatars

**Tradeoffs:**
- Requires a prioritization algorithm (even if simple)
- Could feel weird if the ranking is off ("Why is Alex first? I just saw Alex yesterday")
- More AI "visible" (though still framed as suggestions, not commands)

---

### Option C: "Your next hangout" (Forward-looking)

**What the homepage shows:**

```
┌─────────────────────────────────────────────┐
│ Ready to plan your next hangout?            │
│                                             │
│ Who do you want to see?                     │
│ [Dropdown: Select a friend...]              │
│                                             │
│           [Find times together]             │
└─────────────────────────────────────────────┘
```

**Interaction:**
- Dropdown/autocomplete of all friends
- Select friend → "Find times together" button becomes active → navigates to scheduling

**What data is needed:**
- `friends` array for dropdown

**Why this could be right:**
- **Neutral framing** — No arbitrary pick, no AI ranking
- **One clear action** — Choose friend, then click button
- **Scales to any friend count**

**Tradeoffs:**
- **Two interactions** (dropdown + button) vs. one tap
- Dropdowns are clunky on mobile
- Adds decision friction ("Which friend should I pick from this list?") without helping the user decide
- Feels more transactional, less warm/social

**Verdict:** This is the **weakest option**. Adding a dropdown when you could just show avatars (Option A) or AI suggestions (Option B) is unnecessarily formal.

---

## Recommended Approach

**I recommend Option A: "Pick someone to hang out with"**

### Reasoning

1. **Zero new complexity** — The "People to See" avatar row already exists in the active-user dashboard. We're just reusing that component at an earlier stage.

2. **No AI dependency** — Option B requires a prioritization algorithm (even if simple, it's another thing to build and tune). Option A works today with existing data.

3. **User feels in control** — After a stage where the app told them "connect calendar" and "invite friends," this is the first moment the user gets to **choose**. That's the right beat.

4. **Aligns with Slotted's principles:**
   - **No social pressure** — No ranking, no "you should see..."
   - **AI is invisible** — The AI will rank time suggestions *after* the user picks a friend, not *before*
   - **Soft social dynamics** — Presenting friends as equals (flat grid, no hierarchy)

5. **Natural upgrade path** — Once the user has completed hangouts, we can add "People to catch up with" (Option B) as an *additional section* below the avatar row. But for the first-hangout stage, simplicity wins.

6. **Consistency with V2 plans** — The active-user dashboard already uses this pattern. We're not inventing a new interaction, just reusing a proven one earlier in the journey.

### Implementation Notes

- Component: Reuse the "People to See" avatar row from the active-user dashboard
- Heading: "Who do you want to hang out with?" (question = inviting, not commanding)
- Subtext: "Tap anyone to find times together" (one-tap action = low friction)
- Sort order: Either (1) alphabetical (neutral), (2) most recently added (chronological), or (3) last met (chronological). Avoid any ranking that feels like judgment.
- Fallback: If somehow `friends.length === 0` (edge case), fall back to "no-friends" stage

### What NOT to do

- ❌ Don't show "🟢 Open" or "🔴 Recharging" next to friends (privacy-first)
- ❌ Don't show "12 free blocks" or "Calendar not connected" (no pressure, no leaking private data)
- ❌ Don't rank friends by "who you should see" (no social judgment)
- ❌ Don't pick one friend arbitrarily (current bug)

---

## Long-Term Consideration: Rethinking the Stage System

The root cause of this bug is that the stage system has a **name/logic mismatch**:
- Stage is called `one-friend`
- Logic checks `friendCount > 0` (not `friendCount === 1`)

This suggests the stages were designed assuming a linear progression (0 friends → 1 friend → 2 friends → ...), but in reality users can invite 10 friends at once, or accept 3 friend requests before scheduling anything.

**Recommendation for future refactor:**
- Rename `one-friend` → `first-hangout` (describes the goal, not the friend count)
- Make stages based on **user actions**, not **friend count**:
  - `no-calendar` → user hasn't connected calendar
  - `no-friends` → user hasn't invited anyone
  - `pending-invite` → user has incoming requests
  - `first-hangout` → user has friends but hasn't booked anything yet
  - `has-hangouts` → user has booked 1+ hangouts
  - `active-user` → user is regularly scheduling (3+ friends, 2+ completed)

This makes the stages more resilient to non-linear user journeys.

---

## Implementation Checklist (if Option A chosen)

- [ ] Rename stage in code: `one-friend` → `first-hangout` (or leave as-is if refactor is out of scope)
- [ ] Replace `StageOneFriend` component with new `StageFirstHangout` component
- [ ] Component renders avatar row of all friends (reuse existing avatar row component from active-user dashboard)
- [ ] Heading: "Who do you want to hang out with?"
- [ ] Subtext: "Tap anyone to find times together"
- [ ] Each avatar links to `/friends?findTimes={friendId}`
- [ ] Sort order: alphabetical or most recently added (decide based on what feels right)
- [ ] Test with 1 friend, 3 friends, 10 friends (all should work)
- [ ] Ensure no social pressure signals (battery, calendar status, etc.)

---

## Appendix: Why Not Just Fix the Logic to Check `friendCount === 1`?

You could argue: "Just change line 19 in `userStage.ts` to check `friendCount === 1` instead of `friendCount > 0`, and the bug is fixed."

**Why that's not enough:**

1. **It doesn't solve the user journey problem.** Users don't add friends one at a time. They might invite 5 people at once. If we check `friendCount === 1`, those users skip straight to a different stage, but then which stage? `has-hangouts`? That's also wrong (they haven't booked anything yet).

2. **It creates a new edge case.** What happens when the user has 2 friends and 0 hangouts? They'd fall through to `has-hangouts`, which expects upcoming hangouts to exist. Now the dashboard shows... nothing? An empty "Coming up" section?

3. **It doesn't acknowledge the full network.** The real issue isn't the stage logic — it's that the **`StageOneFriend` component is designed for exactly 1 friend** (picks `friends[friends.length - 1]` and shows "You and {name} are connected!"). That design doesn't scale to multiple friends.

**The right fix is both:**
- Fix the stage logic to be more precise about what it's checking
- Fix the component to handle multiple friends gracefully

Option A does both.
