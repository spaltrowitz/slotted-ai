# Research: Groups Feature Removal

**Status:** Research Complete  
**Date:** 2025-02-XX  
**Context:** User feedback indicates the groups feature adds unnecessary complexity. Users can already select multiple friends and find joint availability without creating a formal group concept.

## Executive Summary

The groups feature (`friend_groups` + `friend_group_members` tables) is a **fully implemented V1 feature** that allows users to create named collections of friends for recurring group scheduling. However, the core **multi-friend scheduling functionality** (finding availability for 2+ friends) works independently of groups via the `GroupAvailability` component. Removing groups means removing the ability to **save** these multi-friend collections, but preserving the ability to **ad-hoc select** multiple friends and find times.

**Key finding:** The `GroupAvailability` component name is misleading — it handles **any** multi-friend scheduling, not just saved groups. It will remain and likely be renamed to `MultiFriendAvailability`.

---

## 1. Frontend Analysis

### 1.1 Core Components

#### **`client/src/components/GroupAvailability.tsx` (325 lines)**
- **Purpose:** Displays joint availability for 2+ friends. Despite the name, this is NOT group-specific — it accepts `friendIds[]` from any source.
- **What it does:**
  - Line 46: `fetchGroupOverlaps()` calls `/availability/group-overlap` with `friendIds`
  - Line 67: `handleBook()` creates a meetup with `friendIds`
  - Lines 121-139: Header says "👥 Group Availability" but this is just UI text
  - Lines 142-163: Shows participant sync status
  - Lines 236-293: Displays scored time suggestions with "Book it" button
- **STAYS (with rename):** This component is the core multi-friend scheduling UI. It just needs rebranding:
  - Rename file to `MultiFriendAvailability.tsx`
  - Change header text from "Group Availability" → "Find Times Together"
  - Remove "group" language from all UI strings

#### **`client/src/pages/FriendsPage.tsx` (large file, ~1000+ lines)**
**Groups-related state (lines 40-62):**
```typescript
const [showGroupAvailability, setShowGroupAvailability] = useState(false);  // Line 40
const [groupFriendIds, setGroupFriendIds] = useState<string[]>([]);        // Line 41
const [groupFriendNames, setGroupFriendNames] = useState<string[]>([]);    // Line 42
const [showCreateGroup, setShowCreateGroup] = useState(false);             // Line 45
const [newGroupName, setNewGroupName] = useState('');                      // Line 46
const [createGroupSelectedIds, setCreateGroupSelectedIds] = useState<Set<string>>(new Set()); // Line 47
const [creatingGroup, setCreatingGroup] = useState(false);                 // Line 48
const [deletingGroup, setDeletingGroup] = useState<{ id: string; name: string } | null>(null); // Line 56
const [deleteGroupLoading, setDeleteGroupLoading] = useState(false);       // Line 57
const [addMemberGroupId, setAddMemberGroupId] = useState<string | null>(null); // Line 62
const [groupFriendRequesting, setGroupFriendRequesting] = useState<Set<string>>(new Set()); // Line 352
const [groupFriendRequested, setGroupFriendRequested] = useState<Set<string>>(new Set()); // Line 353
```

**Groups-related queries (line 75-77):**
```typescript
const { data: groups = [] } = useQuery({
  queryKey: queryKeys.groups,
  queryFn: fetchGroups,
```

**Groups-related mutations (lines 116-133):**
```typescript
const createGroupMutation = useMutation({ ... });  // Line 116
const deleteGroupMutation = useMutation({ ... });  // Line 125
```

**Groups-related handlers:**
- `handleGroupFindTimes(group: SavedGroup)` — Line 244: Opens GroupAvailability with group members
- `handleCreateGroup()` — Line 270: Creates a new group via POST /groups
- `handleDeleteGroup(groupId)` — Line 299: Deletes a group via DELETE /groups/:id
- `handleAddMemberToGroup(groupId, memberId)` — Line 315: Adds member via POST /groups/:id/members
- `toggleCreateGroupFriend(id)` — Line 329: Toggles friend selection in create group modal
- `handleGroupMemberFriendRequest(memberId)` — Line 355: Sends friend request to non-friend group member

**Groups UI sections (approximate, need full file scan):**
- "Create Group" modal
- Saved groups list with delete/edit buttons
- "Add member to group" dropdown
- Group member list with friend request buttons for non-friends

**CRITICAL:** FriendsPage must also have UI for **ad-hoc multi-friend selection** (checkbox-based) that triggers `GroupAvailability` WITHOUT creating a saved group. This is the flow that STAYS.

### 1.2 Other Frontend Files with Group References

#### **`client/src/lib/queries.ts`**
- Line 8: `groups: ['groups'] as const` — query key
- Lines 95-100: `SavedGroup` interface:
  ```typescript
  export interface SavedGroup {
    id: string;
    name: string;
    members: { id: string; displayName: string; photoUrl?: string }[];
    pendingEmails?: string[];
  }
  ```
- Lines 213-216: `fetchGroups()` function:
  ```typescript
  export const fetchGroups = async (): Promise<SavedGroup[]> => {
    const { data } = await api.get<{ groups?: SavedGroup[] }>('/groups');
    return data.groups ?? [];
  };
  ```
**TO DELETE:** Query key, interface, fetch function

#### **`client/src/App.tsx`**
- No group-specific routes found. Groups are accessed via `/friends` page.

#### **`client/src/pages/DashboardPage.tsx`**
- Lines 665-692: Variable names like `groupedEvents` and `groups` — these are **NOT** related to friend groups. They're for grouping calendar events by date. **NO CHANGES NEEDED.**
- Lines 1584-1594: CSS class names like `group` and `group-hover` — these are **Tailwind CSS pseudo-classes** for hover effects. **NO CHANGES NEEDED.**

#### **`client/src/pages/NotificationsPage.tsx`**
- Lines 292-297: Detects group membership notifications:
  ```typescript
  const isGroupMembershipUpdate = /\bgroup\b|added to|removed from|left "/i.test(
    `${notification.title} ${notification.body}`
  );
  ```
**TO DELETE:** This notification filtering logic

#### **`client/src/pages/EventsPage.tsx`**
- Line 94: `'Boston': ['Red Sox', 'Celtics', 'Blue Man Group', ...]` — this is a venue name, not related to groups. **NO CHANGES NEEDED.**
- Lines 998-1002: CSS `group` classes for hover dropdowns. **NO CHANGES NEEDED.**

#### **`client/src/pages/LoginPage.tsx`**
- No meaningful group references found (just UI copy like "group of friends").

#### **`client/src/components/CalendarPicker.tsx`**
- Would need to check for "group" references, but likely none.

---

## 2. Backend Analysis

### 2.1 Group Endpoints in `functions/src/index.ts`

All endpoints are in the 3200-3800 line range:

#### **POST `/availability/group-overlap`** — Line 3208
- **Purpose:** Finds mutual free slots among multiple friends
- **Input:** `{ friendIds: string[] }`
- **Output:** Scored time suggestions, overlaps, participant sync status
- **Used by:** `GroupAvailability` component
- **KEEP (rename route?):** This is the core multi-friend scheduling logic. Rename to `/availability/multi-friend` or `/availability/joint` to remove "group" terminology.

#### **GET `/groups`** — Line 3360
- **Purpose:** List all groups the user created or is a member of
- **Logic:**
  - Line 3368: Queries `friend_group_members` for groups where `user_id = me.id`
  - Line 3373: Queries `friend_groups` for groups where `created_by = me.id`
  - Line 3390: Fetches group details from `friend_groups`
  - Line 3397: Fetches members from `friend_group_members`
  - Returns groups with hydrated member data
- **TO DELETE**

#### **POST `/groups`** — Line 3441
- **Purpose:** Create a new group
- **Input:** `{ name, emoji, memberIds, invitedEmails }`
- **Logic:**
  - Line 3459: Validates memberIds are accepted friends
  - Line 3466: Inserts into `friend_groups`
  - Line 3478: Inserts into `friend_group_members` for creator + members
  - Lines 3486-3527: Handles `invitedEmails`:
    - If user exists and is accepted friend → add to group
    - If user exists but not friend → create friendship + pending_invite with `group_id`
    - If user doesn't exist → create pending_invite with `group_id`
- **TO DELETE**

#### **PUT `/groups/:id`** — Line 3537
- **Purpose:** Update group name, emoji, or members (creator only)
- **Logic:**
  - Line 3558: Updates `friend_groups` name/emoji
  - Line 3585: Deletes all existing `friend_group_members`
  - Line 3588: Inserts new member list
  - Lines 3592-3627: Sends notifications to removed members
- **TO DELETE**

#### **POST `/groups/:id/members`** — Line 3638
- **Purpose:** Add members to a group (any current member can do this)
- **Logic:**
  - Line 3660: Verifies requester is a member
  - Line 3686: Validates new members are accepted friends
  - Line 3694: Inserts into `friend_group_members`
  - Lines 3698-3738: Sends notifications to new + existing members
- **TO DELETE**

#### **DELETE `/groups/:id`** — Line 3747
- **Purpose:** Delete a group (creator only)
- **Logic:**
  - Line 3754: Deletes from `friend_groups` where `created_by = me.id`
  - Cascade delete removes `friend_group_members` automatically
- **TO DELETE**

### 2.2 Related Backend Logic

#### **Pending Invites with `group_id`**
- Lines 3509-3512, 3517-3520 in POST `/groups`: When creating a group with invited emails, `pending_invites` rows are created with `group_id` populated
- **Implication:** When a user signs up via email invite, they're auto-added to the group. This logic exists somewhere in the signup/onboarding flow (not found in this scan but documented in migrations).
- **TO DELETE:** Remove `group_id` column from `pending_invites`, remove auto-add-to-group logic on signup

#### **Meetup Creation with Groups**
- Line 3782 in POST `/meetups`: Accepts both `friendId` (singular) and `friendIds` (array)
- No direct group reference — groups are resolved to `friendIds[]` on the frontend before calling this endpoint
- **NO CHANGES NEEDED** to meetup creation logic

---

## 3. Database Analysis

### 3.1 Tables in `database/schema.sql`

#### **`friend_groups`** — Lines 334-348
```sql
CREATE TABLE friend_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  emoji           TEXT DEFAULT '👥',
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_friend_groups_creator ON friend_groups (created_by);
CREATE TRIGGER trg_friend_groups_updated_at ...
```
**TO DELETE:** Entire table

#### **`friend_group_members`** — Lines 350-363
```sql
CREATE TABLE friend_group_members (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id        UUID NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);
CREATE INDEX idx_friend_group_members_group ON friend_group_members (group_id);
CREATE INDEX idx_friend_group_members_user ON friend_group_members (user_id);
```
**TO DELETE:** Entire table

#### **`pending_invites`** — Lines 366-378
```sql
CREATE TABLE pending_invites (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inviter_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_email   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inviter_id, invited_email)  -- NOTE: migration changed this
);
CREATE INDEX idx_pending_invites_email ON pending_invites (invited_email);
CREATE INDEX idx_pending_invites_inviter ON pending_invites (inviter_id);
```
**MODIFIED BY MIGRATION:** See `migrations/add_group_id_to_pending_invites.sql`

#### **RLS Policies**
- Lines 429-430:
  ```sql
  ALTER TABLE friend_groups        ENABLE ROW LEVEL SECURITY;
  ALTER TABLE friend_group_members ENABLE ROW LEVEL SECURITY;
  ```
**TO DELETE:** These lines

### 3.2 Migrations

#### **`migrations/add_group_id_to_pending_invites.sql`**
```sql
ALTER TABLE pending_invites 
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES friend_groups(id) ON DELETE SET NULL;

-- Drop unique constraint, add new one with group_id
ALTER TABLE pending_invites DROP CONSTRAINT IF EXISTS pending_invites_inviter_id_invited_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_invites_unique 
  ON pending_invites (inviter_id, invited_email, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'));
CREATE INDEX IF NOT EXISTS idx_pending_invites_group ON pending_invites (group_id);
```
**TO REVERSE:** 
- Drop `group_id` column
- Restore original `UNIQUE (inviter_id, invited_email)` constraint
- Drop `idx_pending_invites_group` index

**No other migrations reference groups.**

---

## 4. Notification Analysis

### 4.1 Group-Related Notification Types

#### **Type: `friend_accepted` (repurposed for group notifications)**
The app repurposes the `friend_accepted` type for group membership updates:

**1. Added to group** — `functions/src/index.ts:3708-3716`
```typescript
await createNotification({
  userId: uid,
  type: "friend_accepted",
  title: `Added to "${group?.name || 'a group'}"`,
  body: `${me.display_name || "Someone"} added you to the group "${group?.name || ''}" on Slotted`,
  relatedUserId: me.id,
  relatedId: groupId,
});
```

**2. Removed from group** — Line 3596-3604
```typescript
await createNotification({
  userId: removedId as string,
  type: "friend_accepted",
  title: `Removed from "${group.name || 'a group'}"`,
  body: `You were removed from the group "${group.name || ''}" by ${me.display_name || "the group owner"}.`,
  relatedUserId: me.id,
  relatedId: groupId,
});
```

**3. Someone left/was removed** — Line 3618-3625 (sent to remaining members)
```typescript
await createNotification({
  userId: remainingId,
  type: "friend_accepted",
  title: `${namesStr} left "${group.name || 'your group'}"`,
  body: `${namesStr} ${removedIds.length === 1 ? 'was' : 'were'} removed from "${group.name || ''}" by ${me.display_name || "the group owner"}.`,
  relatedUserId: me.id,
  relatedId: groupId,
});
```

**4. New member joined** — Line 3729-3736
```typescript
await createNotification({
  userId: existingId as string,
  type: "friend_accepted",
  title: `${namesStr} joined "${group?.name || 'your group'}"`,
  body: `${me.display_name || "Someone"} added ${namesStr} to the group "${group?.name || ''}"`,
  relatedUserId: me.id,
  relatedId: groupId,
});
```

### 4.2 Notification Handling on Frontend

**`client/src/pages/NotificationsPage.tsx` — Lines 292-297:**
```typescript
const isGroupMembershipUpdate = /\bgroup\b|added to|removed from|left "/i.test(
  `${notification.title} ${notification.body}`
);
const isFriendJoinedNotification =
  notification.type === 'friend_accepted' &&
  !isGroupMembershipUpdate;
```

**TO DELETE:**
- All 4 notification creation calls in backend
- Frontend detection logic for `isGroupMembershipUpdate`

**CONSIDERATION:** These notifications use `type: "friend_accepted"` which is also used for actual friend accepts. Removing these won't break the notification type system.

---

## 5. What STAYS

### 5.1 Multi-Friend Scheduling (The Core Feature)

**Frontend flow:**
1. User goes to `/friends`
2. Selects 2+ friends (checkboxes)
3. Clicks "Find Group Times" button
4. `GroupAvailability` component opens with `friendIds[]`
5. User sees joint availability, books a time
6. Meetup is created with all selected friends

**Backend support:**
- POST `/availability/group-overlap` (rename suggested)
- POST `/meetups` (already supports `friendIds[]`)

**UI Changes Needed:**
- Rename button from "Find Group Times" → "Find Times Together" or "Find Times (2+ friends)"
- Rename `GroupAvailability` component to `MultiFriendAvailability`
- Remove all "group" language: "👥 Group Availability (3 people)" → "Find Times Together (3 people)"

### 5.2 Unaffected Features

- **1-on-1 scheduling:** Single friend selection + availability view
- **Friendships:** No change to `friendships` table or logic
- **Meetups:** No change to `meetups` or `meetup_participants` tables
- **Calendar sync:** No change to availability or calendar logic
- **Pending invites (for friendships):** `pending_invites` table still used for email-based friend invites, just without `group_id`

---

## 6. Scope Summary

### 6.1 Files to Delete
- None (no standalone group files)

### 6.2 Files to Modify

#### **Frontend (8 files)**
1. **`client/src/components/GroupAvailability.tsx`**
   - Rename to `MultiFriendAvailability.tsx`
   - Update all UI strings: "Group Availability" → "Find Times Together"
   - Line 121-139: Header text changes
   
2. **`client/src/pages/FriendsPage.tsx`** (MAJOR CHANGES)
   - Remove: All group state variables (lines 40-62, 352-353)
   - Remove: `useQuery` for groups (line 75-77)
   - Remove: `createGroupMutation`, `deleteGroupMutation` (lines 116-133)
   - Remove: `handleGroupFindTimes`, `handleCreateGroup`, `handleDeleteGroup`, `handleAddMemberToGroup`, `toggleCreateGroupFriend`, `handleGroupMemberFriendRequest` (lines 244-355)
   - Remove: "Create Group" modal UI
   - Remove: Saved groups list UI
   - Remove: Group member management UI
   - Keep: Multi-friend selection checkboxes
   - Keep: "Find Times Together" button (rename from "Find Group Times")
   - Update: Import statement (line 8) to use new component name

3. **`client/src/lib/queries.ts`**
   - Line 8: Remove `groups: ['groups']`
   - Lines 95-100: Remove `SavedGroup` interface
   - Lines 213-216: Remove `fetchGroups()` function

4. **`client/src/pages/NotificationsPage.tsx`**
   - Lines 292-297: Remove `isGroupMembershipUpdate` detection logic

5. **`client/src/lib/api.ts`**
   - No changes needed (generic API client)

6. **`client/src/App.tsx`**
   - No changes needed (no group routes)

7. **`client/src/pages/DashboardPage.tsx`**
   - No changes needed (all "group" references are for CSS or calendar event grouping)

8. **`client/src/pages/EventsPage.tsx`**
   - No changes needed (all "group" references are for CSS or venue names)

#### **Backend (1 file)**
9. **`functions/src/index.ts`** (MAJOR CHANGES)
   - Line 3208: Rename endpoint `/availability/group-overlap` → `/availability/multi-friend` or `/availability/joint`
   - Lines 3360-3437: Delete entire `GET /groups` endpoint
   - Lines 3441-3534: Delete entire `POST /groups` endpoint
   - Lines 3537-3635: Delete entire `PUT /groups/:id` endpoint
   - Lines 3638-3744: Delete entire `POST /groups/:id/members` endpoint
   - Lines 3747-3766: Delete entire `DELETE /groups/:id` endpoint
   - Lines 3509-3512, 3517-3520: Remove `group_id` handling in pending invites logic
   - Lines 3596-3604, 3618-3625, 3708-3716, 3729-3736: Remove 4 group-related notification creation calls

#### **Database (2 files)**
10. **`database/schema.sql`**
    - Lines 334-348: Remove `friend_groups` table definition
    - Lines 350-363: Remove `friend_group_members` table definition
    - Lines 429-430: Remove RLS enable statements for group tables
    - **NOTE:** Do NOT modify `pending_invites` table here (it existed before groups)

11. **`migrations/add_group_id_to_pending_invites.sql`**
    - This migration will be superseded by a new **down migration** that reverses it

### 6.3 New Migrations to Create

1. **`migrations/remove_groups_feature.sql`**
   ```sql
   -- Reverse the group_id addition to pending_invites
   DROP INDEX IF EXISTS idx_pending_invites_group;
   DROP INDEX IF EXISTS idx_pending_invites_unique;
   ALTER TABLE pending_invites DROP COLUMN IF EXISTS group_id;
   
   -- Restore original unique constraint
   CREATE UNIQUE INDEX pending_invites_inviter_id_invited_email_key 
     ON pending_invites (inviter_id, invited_email);
   
   -- Delete group tables (cascade will remove members)
   DROP TABLE IF EXISTS friend_group_members;
   DROP TABLE IF EXISTS friend_groups;
   ```

### 6.4 Endpoint Changes

| Endpoint | Action | Notes |
|----------|--------|-------|
| `POST /availability/group-overlap` | **Rename** to `/availability/multi-friend` | Keep logic, just rename |
| `GET /groups` | **DELETE** | — |
| `POST /groups` | **DELETE** | — |
| `PUT /groups/:id` | **DELETE** | — |
| `POST /groups/:id/members` | **DELETE** | — |
| `DELETE /groups/:id` | **DELETE** | — |
| `POST /meetups` | **No change** | Already supports `friendIds[]` |

---

## 7. Edge Cases & Risks

### 7.1 Data Loss
- **Users with existing saved groups:** All groups will be deleted. No way to preserve them since we're removing the feature entirely.
- **Mitigation:** Consider an export feature or one-time email notification to users who have groups (optional, depends on user base size).

### 7.2 Pending Invites with group_id
- **Risk:** Users invited to a group who haven't signed up yet. When they sign up, the old code tries to add them to a non-existent group.
- **Mitigation:** Migration must run BEFORE code deploy. Delete all `pending_invites` rows with `group_id IS NOT NULL` or nullify the `group_id` column before dropping it.

### 7.3 Notifications in Flight
- **Risk:** Users may have unread group membership notifications.
- **Mitigation:** These notifications will become dead links (clicking them won't do anything). Acceptable since they're using `type: "friend_accepted"` which has no special handling.

### 7.4 Frontend Caching
- **Risk:** Users with cached group data in React Query cache.
- **Mitigation:** Increment the app version or add a cache buster. Removing the `fetchGroups` call will cause the query to fail silently on next mount.

### 7.5 Multi-Friend Scheduling Discoverability
- **Risk:** Without saved groups, users may forget they can select multiple friends.
- **Mitigation:** Add UI hints:
  - Tooltip on friend checkboxes: "Select 2+ friends to find times together"
  - Empty state when no friends selected: "👥 Select friends to find 1-on-1 or group times"
  - Disable "Find Times Together" button until 2+ friends selected

---

## 8. Testing Checklist (For Implementation Phase)

### Backend
- [ ] `/availability/multi-friend` works with 2 friends
- [ ] `/availability/multi-friend` works with 3+ friends
- [ ] All 5 group endpoints return 404 or are removed
- [ ] POST `/meetups` with `friendIds[]` still works
- [ ] Pending invites without `group_id` still work
- [ ] Signup flow doesn't attempt to add users to groups

### Frontend
- [ ] FriendsPage loads without group query
- [ ] Multi-friend selection works (checkboxes)
- [ ] "Find Times Together" button opens `MultiFriendAvailability`
- [ ] `MultiFriendAvailability` shows correct UI text (no "group" language)
- [ ] Booking a multi-friend meetup works
- [ ] No group create/edit/delete UI visible
- [ ] No group-related notifications appear

### Database
- [ ] `friend_groups` table dropped
- [ ] `friend_group_members` table dropped
- [ ] `pending_invites.group_id` column dropped
- [ ] Original unique constraint on `pending_invites` restored
- [ ] No orphaned foreign keys

---

## 9. Deployment Plan (High-Level)

1. **Run migration** to drop tables and columns
2. **Deploy backend** with group endpoints removed
3. **Deploy frontend** with group UI removed
4. **Monitor** for errors related to cached queries or pending invites
5. **Optional:** Send email to users who had groups explaining the change

---

## 10. Open Questions

1. **What is the current ad-hoc multi-friend selection UI in FriendsPage?**
   - Need to confirm it exists and identify its location in the file.
   - If it doesn't exist, it needs to be added as part of this work.

2. **Should we rename the `/availability/group-overlap` endpoint or leave it?**
   - Renaming is cleaner but requires frontend API call update.
   - Leaving it as-is works but perpetuates confusing naming.

3. **Should we notify users about the change?**
   - Depends on how many users have created groups.
   - Query: `SELECT COUNT(DISTINCT created_by) FROM friend_groups;`

4. **Is there onboarding or help text mentioning groups?**
   - Need to search for any UI copy or tooltips that reference "create a group" or "saved groups".

---

## Next Steps

This research is complete. Awaiting Shari's decision on:
1. Whether to proceed with removal
2. Whether to notify users
3. Whether to rename the backend endpoint
4. Whether to add inline notes to this document for clarification

Once approved, create:
- `docs/plans/plan-groups-removal.md` — detailed implementation plan with code snippets
