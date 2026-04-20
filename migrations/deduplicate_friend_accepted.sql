-- Migration: Deduplicate friend_accepted notifications and add DB-level unique constraint
-- Run this in Supabase SQL Editor
--
-- Context: The groups feature was removed (see .squad/decisions.md entry from 2026-03-04 and
-- docs/plans/research-groups-removal.md). The previous migration (deduplicate_notifications.sql)
-- intentionally excluded friend_accepted from a unique index because the type was overloaded
-- for group-membership events. That rationale is now stale. This migration adds the constraint
-- that was deferred at that time.

-- Step 1: Delete pre-existing duplicate friend_accepted rows, keeping the earliest per
-- (user_id, related_user_id) pair.
DELETE FROM notifications
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY user_id, related_user_id
      ORDER BY created_at ASC
    ) AS rn
    FROM notifications
    WHERE type = 'friend_accepted' AND related_user_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Step 2: Create a partial unique index to prevent future duplicates at the DB level.
-- Safe now that groups have been removed and friend_accepted is no longer overloaded.
-- The existing 23505 duplicate-key handler in createNotification() will cleanly swallow
-- any race-condition collisions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_no_dup_friend_accepted
  ON notifications (user_id, type, related_user_id)
  WHERE type = 'friend_accepted' AND related_user_id IS NOT NULL;
