-- Add group_id to pending_invites so invited-by-email users 
-- are auto-added to the group when they sign up
ALTER TABLE pending_invites 
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES friend_groups(id) ON DELETE SET NULL;

-- Drop the existing unique constraint so the same email can be invited 
-- to multiple groups by the same person
ALTER TABLE pending_invites DROP CONSTRAINT IF EXISTS pending_invites_inviter_id_invited_email_key;

-- New unique constraint: one invite per (inviter, email, group) combo
-- group_id can be NULL for non-group invites
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_invites_unique 
  ON pending_invites (inviter_id, invited_email, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'));

CREATE INDEX IF NOT EXISTS idx_pending_invites_group ON pending_invites (group_id);
