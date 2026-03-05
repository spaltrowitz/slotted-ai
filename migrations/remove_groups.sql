-- Migration: Remove Groups Feature
-- Date: 2026-XX-XX
-- Description: Drops friend_groups and friend_group_members tables,
--              removes group_id column from pending_invites,
--              and restores the original unique constraint.

-- 1. Drop friend_group_members (depends on friend_groups via FK)
DROP TABLE IF EXISTS friend_group_members CASCADE;

-- 2. Drop friend_groups
DROP TABLE IF EXISTS friend_groups CASCADE;

-- 3. Remove group_id column and related index from pending_invites
DROP INDEX IF EXISTS idx_pending_invites_group;
DROP INDEX IF EXISTS idx_pending_invites_unique;
ALTER TABLE pending_invites DROP COLUMN IF EXISTS group_id;

-- 4. Restore original unique constraint on pending_invites
ALTER TABLE pending_invites
  ADD CONSTRAINT pending_invites_inviter_id_invited_email_key
  UNIQUE (inviter_id, invited_email);
