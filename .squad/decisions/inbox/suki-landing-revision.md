## Decision: Landing Page Revision — Badge Emoji + "Why It Matters" Layout (Suki, 2026-03-03)

| Field | Value |
|---|---|
| **Author** | Suki (Designer) |
| **Date** | 2026-03-03 |
| **Status** | Implemented |
| **Scope** | LoginPage.tsx — user feedback revision |

### Summary

Two targeted revisions based on Shari's feedback on the previous landing page redesign.

### Changes

#### 1. Early Access Badge Emoji

**Problem:** Both the Early Access badge and "Get suggestions" (step 3 in How It Works) used ✨, creating a duplicate.

**Fix:** Swapped badge emoji from ✨ → 🎟️. The ticket/pass emoji conveys exclusivity ("limited spots") without clashing with the sparkle used for AI suggestions.

#### 2. "Why It Matters" Section — Layout Overhaul

**Problem:** The dark slate gradient panel didn't look good per user feedback. Cards were too wide (2-column grid) and not mobile-optimized.

**Fix:**
- Removed dark gradient panel entirely (`from-slate-900 via-slate-800`)
- Switched to single-column stacked layout (`max-w-md`, `flex-col gap-3`)
- Cards are now compact: `rounded-xl`, `px-4 py-3` (was `rounded-2xl p-5`)
- Visual differentiation via colored left-border accent (`border-l-[3px]`) per card — teal, violet, amber, pink, cyan
- Light translucent background (`bg-white/70 backdrop-blur-sm`) stays cohesive with page
- Emoji + title on same line, description indented below — tighter, more scannable
- Privacy card now inline with others (was orphaned in a centered half-width wrapper)

### Design Rationale

- Single-column is inherently mobile-first — no grid breakpoints needed
- Left-border accents create enough visual distinction from "How It Works" without needing a heavy background panel
- Smaller cards reduce scroll distance — the whole section is more compact
- Each card's accent color adds personality without overwhelming

### New Convention

- **Audit emoji uniqueness** across all landing page sections before shipping. No two visible sections should share the same decorative emoji.
