# Research: Calendar Selection UX Issue on Friends Tab

**Date:** 2025-01-XX  
**Reporter:** Shari Paltrowitz  
**Researcher:** Katara (Frontend Dev)

---

## Problem Statement

When users select multiple friends on the Friends tab to find group availability, there is **no visual feedback** indicating that they are in a multi-select mode for *calendars*. The confusion likely stems from the fact that the UI **does show** friend selection state (background color, checkmark badge on avatar) but users may be expecting a different pattern or looking for checkboxes.

---

## Current Implementation

### Friends Tab Multi-Select Flow (`FriendsPage.tsx`)

The Friends tab implements a **long-press to activate multi-select** pattern:

1. **Entry:** Long-press (500ms) or right-click on a friend row activates `selectMode`
2. **Selection State:** 
   - Selected friend rows get a light slotted background (`bg-slotted-50/60`)
   - A small checkmark badge appears on the friend's avatar (green circle with white checkmark, positioned bottom-right)
   - `selectedIds` Set tracks which friend IDs are selected
3. **Deselection:** Tapping a selected friend removes them from the set
4. **Exit:** "Cancel" button in the top-right exits select mode
5. **Action:** When 2+ friends are selected, a floating action button appears at the bottom: "Find time for {N} friends →"

**Key lines from `FriendsPage.tsx`:**
- Lines 29-31: State for `selectMode` and `selectedIds`
- Lines 150-155: Long-press handler activates select mode
- Lines 203-206: Background color changes when selected (`isSelected ? 'bg-slotted-50/60' : 'hover:bg-gray-50/50'`)
- Lines 215-221: Checkmark badge appears when `selectMode && isSelected`
- Lines 246-251: "Select" / "Cancel" button toggles select mode
- Lines 394-406: Floating action button for group scheduling

### Calendar Selection UI (`CalendarPicker.tsx`)

The `CalendarPicker` component is used in **Settings**, not on the Friends tab. It implements a **standard checkbox list** pattern:

1. **Visual indicators:**
   - Checkbox input (line 157-162): Standard HTML checkbox styled with Tailwind
   - Background gradient when selected: `bg-gradient-to-r from-gray-50 to-gray-100/50` (line 152-154)
   - Selected calendar names are darker (`text-gray-900` vs `text-gray-500`)
2. **Selection count:** "X of Y selected" shown above the list (line 245-247)
3. **Quick actions:** "Select all" / "None" buttons (line 248-255)
4. **Auto-save:** Debounced save (450ms) after any selection change (line 109-124)

**The calendar picker is NOT used for friend selection.** It's only used for choosing which Google/Apple/Outlook calendars to sync.

---

## Why It's Confusing

### 1. **Hidden Entry Point**
- Multi-select mode is activated by **long-press** — a gesture many users don't discover
- The "Select" button in the top-right is visible but easy to miss (small, gray text)
- No onboarding tooltip or hint that multi-select exists

### 2. **Subtle Visual State**
- The background color change (`bg-slotted-50/60`) is very light and may not be obvious
- The checkmark badge is small (16×16px, positioned on the avatar) and may be overlooked
- **No checkboxes** — users familiar with multi-select in other apps (email, photos, files) expect checkboxes on the left side of each row

### 3. **Mode Confusion**
- In normal mode: tapping a friend opens their availability panel (single selection)
- In select mode: tapping a friend toggles selection (multi-selection)
- The mode switch is implicit — only indicated by the background color and the "Cancel" button text changing

### 4. **Mismatch with Calendar Picker Pattern**
- The `CalendarPicker` component uses checkboxes and shows "X of Y selected"
- Users may expect a similar pattern for friend selection, since both are multi-select scenarios
- However, friend selection uses a checkbox-less, gesture-driven pattern instead

---

## Relevant UX Audit Items

From `docs/10-ux-audit-checklist.md`:

- **5b.5:** "Does the friend selection → floating action bar flow feel natural?" — This is likely a ⚠️ or ❌ item
- **6.3:** Touch targets at least 44×44px — The "Select" button is small (estimated 32-36px height)
- **8.3:** Edge case: What if user taps "Select" but doesn't understand how to select friends?

---

## Recommendation

### Option A: Add Checkboxes (Strongest Alignment with Patterns)

**What:** Add visible checkboxes to the left side of each friend row when in select mode.

**Why:**
- Checkboxes are the universal pattern for multi-select (email, file managers, photo galleries)
- Matches the existing `CalendarPicker` pattern, creating consistency across the app
- Makes the selection state unambiguous — checkbox = selectable item
- Checkbox is a clear affordance that "this row can be toggled"

**Implementation:**
- When `selectMode` is true, render a checkbox on the left side of each friend row (before the avatar)
- Checkbox should be 20×20px minimum (target 24×24px with padding for 44×44px tap target)
- Use Tailwind's checkbox styling (same as `CalendarPicker`): `h-4 w-4 rounded border-gray-300 text-slotted-500 focus:ring-slotted-400`
- Keep the checkmark badge on the avatar OR remove it (checkboxes may be sufficient)
- Consider adding a "select all" option at the top when in select mode (like `CalendarPicker`)

**Files to modify:**
- `client/src/pages/FriendsPage.tsx` (renderFriendRow function, lines 187-238)

---

### Option B: Highlight Selection State More Prominently (Lighter Touch)

**What:** Keep the current gesture-driven pattern but make the visual state much more obvious.

**Why:**
- Preserves the clean, minimal look (no checkboxes cluttering the UI)
- Faster for power users (tap to select, no need to aim for a checkbox)
- May feel more native/modern (iOS-style selection)

**Implementation:**
- Increase the background color intensity when selected (e.g., `bg-slotted-100` instead of `bg-slotted-50/60`)
- Add a subtle left border when selected (e.g., `border-l-4 border-slotted-500`)
- Make the checkmark badge larger (20×20px instead of 16×16px)
- Add a selection count at the top: "2 friends selected" (only when `selectedIds.size > 0`)
- Show the "Select" button more prominently (e.g., outlined button instead of text-only)

**Files to modify:**
- `client/src/pages/FriendsPage.tsx` (renderFriendRow, header section)

---

### Option C: Hybrid Approach (Recommended)

**What:** Combine checkboxes with improved visual state.

**Why:**
- Checkboxes make the selection mechanism explicit
- Enhanced visual state reinforces what's selected
- Best of both worlds: discoverability + clarity

**Implementation:**
- Add checkboxes when in select mode (Option A)
- Keep the background color change and checkmark badge (or just use checkbox)
- Add selection count at the top: "2 of 5 friends selected" (like `CalendarPicker`)
- Make the "Select" button more prominent (maybe a small outlined button with an icon)
- Consider showing "Select all" / "Clear" quick actions when in select mode

**Files to modify:**
- `client/src/pages/FriendsPage.tsx` (renderFriendRow, header section)

---

## Design Tokens & Patterns to Reuse

From the existing codebase:

### Checkbox Styling (from `CalendarPicker.tsx`):
```tsx
<input
  type="checkbox"
  checked={isSelected}
  onChange={() => toggleSelect(friendId)}
  className="h-4 w-4 rounded border-gray-300 text-slotted-500 focus:ring-slotted-400"
/>
```

### Selection Count (from `CalendarPicker.tsx`, line 245):
```tsx
<p className="text-[11px] text-gray-400">
  {selectedCount} of {total} selected
</p>
```

### Quick Actions (from `CalendarPicker.tsx`, line 248-255):
```tsx
<div className="flex gap-2">
  <button onClick={selectAll} className="text-[11px] font-medium text-slotted-500 hover:text-slotted-600">
    Select all
  </button>
  <span className="text-gray-300">·</span>
  <button onClick={deselectAll} className="text-[11px] font-medium text-gray-400 hover:text-gray-600">
    None
  </button>
</div>
```

### Selected Row Background (already in use, could be intensified):
```tsx
className={`... ${isSelected ? 'bg-slotted-50/60' : 'hover:bg-gray-50/50'}`}
```

---

## Edge Cases to Consider

1. **Empty state:** What if user taps "Select" but has only 1 friend? (Currently shows "Select" only when `acceptedFriends.length > 1`, line 245)
2. **Selection persistence:** Should selection persist if user exits and re-enters select mode? (Currently clears on exit, line 158-160)
3. **Keyboard navigation:** Can users navigate and select friends with keyboard? (Currently no keyboard support for selection)
4. **Screen reader support:** Is the selection state announced? (Currently no ARIA labels for select mode)

---

## Additional Context

### Related Components
- **FriendAvailability.tsx:** Shows availability for a single friend (not related to multi-select)
- **GroupAvailability.tsx:** Shows availability for multiple friends (this is where the selected friends go after clicking the floating action button)

### User Flow
1. User lands on Friends tab
2. User taps "Select" button (or long-presses a friend)
3. User taps multiple friends to select them
4. Floating action button appears: "Find time for 2 friends →"
5. User taps the button → navigates to group availability view

---

## Next Steps

1. **Validate with Shari:** Confirm which option aligns with Slotted's design principles
2. **Check beta feedback:** Review `docs/11-beta-tester-feedback.md` for related issues
3. **Write plan:** Create `plan-calendar-selection-ux.md` with specific code changes
4. **Implement:** Make the changes to `FriendsPage.tsx`
5. **Test:** Verify on mobile (iOS + Android) that the new UI is clear and accessible

