-- Migration: Add blocked_users table for block/mute feature
-- Idempotent: uses IF NOT EXISTS throughout

-- ============================================================
-- Step 1: Create blocked_users table
-- ============================================================
CREATE TABLE IF NOT EXISTS blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_block_pair UNIQUE (blocker_id, blocked_id),
  CONSTRAINT no_self_block CHECK (blocker_id != blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON blocked_users (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users (blocked_id);

-- ============================================================
-- Step 2: Enable RLS
-- ============================================================
ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Step 3: RLS Policies (own rows only)
-- ============================================================
DO $$
BEGIN
  -- SELECT: user can see blocks they created
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'blocked_users_select_own' AND tablename = 'blocked_users') THEN
    EXECUTE $policy$
      CREATE POLICY blocked_users_select_own ON blocked_users
        FOR SELECT USING (blocker_id = get_current_user_id())
    $policy$;
  END IF;

  -- INSERT: user can only create blocks where they are the blocker
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'blocked_users_insert_own' AND tablename = 'blocked_users') THEN
    EXECUTE $policy$
      CREATE POLICY blocked_users_insert_own ON blocked_users
        FOR INSERT WITH CHECK (blocker_id = get_current_user_id())
    $policy$;
  END IF;

  -- DELETE: user can only remove their own blocks
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'blocked_users_delete_own' AND tablename = 'blocked_users') THEN
    EXECUTE $policy$
      CREATE POLICY blocked_users_delete_own ON blocked_users
        FOR DELETE USING (blocker_id = get_current_user_id())
    $policy$;
  END IF;
END $$;
