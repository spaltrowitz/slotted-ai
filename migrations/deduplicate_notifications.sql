-- Migration: Deduplicate existing notifications and add DB-level prevention
-- Run this in Supabase SQL Editor

-- Step 1: Delete duplicate friend_request notifications, keeping the earliest per
-- (user_id, related_user_id). Safe because friend_request is only created in one
-- code path and should never have duplicates.
DELETE FROM notifications
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, related_user_id
        ORDER BY created_at ASC
      ) AS rn
    FROM notifications
    WHERE type = 'friend_request' AND related_user_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Step 1b: Delete duplicate friend_accepted notifications that look like actual
-- friend-acceptance duplicates (not group membership notifications).
-- Only dedup rows with titles matching the known acceptance patterns.
DELETE FROM notifications
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, related_user_id
        ORDER BY created_at ASC
      ) AS rn
    FROM notifications
    WHERE type = 'friend_accepted'
      AND related_user_id IS NOT NULL
      AND (title LIKE '%friend%' OR title LIKE '%joined%' OR title LIKE '%connected%' OR title LIKE '%accepted%')
  ) ranked
  WHERE rn > 1
);

-- Step 2: Create a partial unique index to prevent future duplicates at the DB level.
-- IMPORTANT: Only covers 'friend_request', NOT 'friend_accepted'.
-- Reason: 'friend_accepted' is reused for group membership notifications
-- (added to group, removed from group) with the same relatedUserId. A unique
-- index on friend_accepted would silently block those legitimate notifications
-- via the 23505 handler. The app-level dedup in createNotification (1-hour
-- window on relatedUserId) is sufficient for friend_accepted.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_no_dup_friend
  ON notifications (user_id, type, related_user_id)
  WHERE type = 'friend_request';

-- Step 3: For calendar_match, we allow multiple notifications per friend pair
-- (e.g., "both free this weekend" can recur weekly), so no unique index there.
-- For friend_accepted, see note above — app-level dedup handles it.
-- The app-level 1-hour dedup window in createNotification handles both cases.
