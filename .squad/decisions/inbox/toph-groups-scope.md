# Decision: Groups Feature Removal Scope

**Date:** 2025-02-XX  
**Decider:** Toph (Lead/Architect)  
**Status:** PROPOSED — Awaiting Shari's approval

## Context

User feedback indicated the app feels "too busy," with specific callout that the groups feature is unnecessary since users can already select multiple friends and find joint availability without creating a formal group.

## Analysis

Completed full scope analysis of groups feature (see `docs/plans/research-groups-removal.md`). Key findings:

1. **Groups feature is fully implemented** — 2 DB tables, 5 endpoints, extensive UI
2. **Multi-friend scheduling is independent** — the `GroupAvailability` component works with ANY friendIds array, not just saved groups
3. **Removal is clean** — no shared logic with core features. Groups are a pure add-on.
4. **Naming is misleading** — "GroupAvailability" component should be "MultiFriendAvailability"

## Decision

**RECOMMEND removing the groups feature entirely** while preserving multi-friend scheduling:

### Remove:
- `friend_groups` and `friend_group_members` tables
- 5 group endpoints: `GET /groups`, `POST /groups`, `PUT /groups/:id`, `POST /groups/:id/members`, `DELETE /groups/:id`
- Group CRUD UI in FriendsPage (~400 lines of state/handlers/modals)
- `group_id` column on `pending_invites`
- 4 group notification types
- `SavedGroup` interface and `fetchGroups()` query

### Keep (with rebrand):
- Multi-friend scheduling flow: select 2+ friends → find times → book
- `GroupAvailability` component (rename to `MultiFriendAvailability`)
- `/availability/group-overlap` endpoint (rename to `/availability/multi-friend`)
- POST `/meetups` with `friendIds[]` support

### Impact:
- **Users:** All saved groups deleted. Can still schedule with multiple friends, just can't save those collections.
- **Code:** ~600 lines removed total (frontend + backend), 2 tables dropped, simpler UX
- **Risk:** Pending invites with `group_id` must be handled in migration

## Alternatives Considered

1. **Keep groups but improve UX** — Rejected. Adds complexity for marginal value.
2. **Remove UI but keep backend** — Rejected. Dead code is technical debt.
3. **Deprecate gradually** — Rejected. User base is small (early access), clean break is better.

## Next Steps

If approved:
1. Create `docs/plans/plan-groups-removal.md` with detailed implementation plan
2. Write migration `migrations/remove_groups_feature.sql`
3. Execute removal in single PR with full test coverage

**Awaiting Shari's decision.**
