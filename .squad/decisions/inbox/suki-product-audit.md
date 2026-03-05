# Design Decision: UI Simplification — Product Audit Results

**Date:** 2025-07-25  
**Author:** Suki (Designer)  
**Status:** Awaiting Review

---

## Summary

Completed a full product design and user research audit for Slotted. The core finding is that the app's "aha moment" (finding overlapping free times with a friend) is buried under feature creep.

## Key Decisions Proposed

### 1. Remove Groups Feature
**Rationale:** Duplicates multi-friend selection that already exists. Adds ~160 lines of UI complexity for marginal convenience of "saving" friend selections. Beta feedback explicitly called this out as unnecessary.

**Impact:** Simpler FriendsPage, clearer mental model, reduced code surface.

### 2. Remove Dashboard Calendar View
**Rationale:** Users already have Google Calendar. The calendar view doesn't enable scheduling — it just displays information the user can see elsewhere. Removing it makes the "Find times with a friend" CTA more prominent.

**Impact:** ~400 lines of code removed, cleaner dashboard, faster page load.

### 3. Consider Removing Events Page from V1
**Rationale:** Events (discovery, search, saved) is a "nice to have" that distracts from the core loop of scheduling with friends. Beta user Emma specifically noted the value is in group coordination, not event discovery.

**Recommendation:** Defer to V2, or demote to secondary feature accessible only from Friends page.

### 4. Simplify Information Architecture
- Dashboard: 15 sections → 3 (Upcoming, Catch up, CTA)
- Notifications: 3 tabs → 1 unified list
- Settings: 4 tabs → 2 tabs
- Nav: 4 items → 3 (move Settings to menu)

### 5. Emoji Reduction
Remove 24 decorative emojis that duplicate text labels. Keep 84 functional emojis (state indicators, category icons, pickers).

## Full Analysis

See `docs/plans/research-product-design-audit.md` for complete rationale, page-by-page recommendations, feature tiers, and beta feedback integration.

## Next Steps

1. Shari reviews this audit
2. Annotate with feedback/notes
3. Create implementation plan based on approved recommendations
4. Coordinate with Toph (Groups removal) and Katara (frontend changes)
