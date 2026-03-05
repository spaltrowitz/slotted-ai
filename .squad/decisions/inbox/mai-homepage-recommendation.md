# Decision: Multi-Friend Homepage Treatment

**Date:** 2026-03-05  
**Agent:** Mai (Product Strategist)  
**Status:** Recommendation awaiting approval  
**Related docs:** `docs/plans/mai-homepage-recommendation.md`

---

## Problem

User with 10 friends sees arbitrary single-friend message on homepage: "You and Mindy are connected! ❤️ Ready to find time to hang out? → Find times with Mindy"

This is jarring because:
- She has 10 friends, not just Mindy
- The pick feels random (it's actually most recent connection, but user doesn't know that)
- The homepage should acknowledge the full network

---

## Root Cause

Stage system bug:
- Stage called `one-friend` but logic checks `friendCount > 0 && completedHangoutCount === 0`
- Triggers for **any** user with friends who hasn't completed a hangout yet
- `StageOneFriend` component picks `friends[friends.length - 1]` (most recent connection)

The stage was designed assuming users add friends one at a time, but users can invite 10 friends at once.

---

## Recommended Solution

**Option A: Avatar row of all friends** (see full analysis in recommendation doc)

Replace arbitrary single-friend message with:
- Horizontal scrollable row of friend avatars
- Heading: "Who do you want to hang out with?"
- Subtext: "Tap anyone to find times together"
- Each avatar links to scheduling flow

**Why:**
- Acknowledges full network (all 10 friends visible)
- User agency (they choose, not the app picking)
- Zero new complexity (reuses existing avatar row component)
- No AI dependency (works with existing data)
- Aligns with Slotted principles (no social pressure, no ranking)

---

## Alternatives Considered

**Option B:** AI-ranked "People to catch up with" list (2-3 friends by days-since-last-met)
- Pro: Helpful priority suggestions
- Con: Requires algorithm, could feel weird if ranking is off, more complexity

**Option C:** Dropdown to select friend + "Find times" button
- Pro: Neutral (no ranking, no arbitrary pick)
- Con: Two interactions instead of one tap, clunky on mobile, adds decision friction

---

## Implementation Notes

- Reuse existing "People to See" avatar row component from active-user dashboard
- Sort order: alphabetical or most recently added (decide based on feel)
- No social pressure signals (battery, calendar status, free slot counts)
- Consider renaming stage `one-friend` → `first-hangout` (reflects goal, not friend count)

---

## Decision Required

Approve Option A (avatar row) or request alternative approach?
