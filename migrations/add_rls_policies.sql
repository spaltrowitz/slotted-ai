-- Migration: Defensive RLS policies on all tables
-- These policies use Supabase's auth.uid() which maps to the authenticated user's Firebase UID.
-- The service_role key bypasses RLS entirely — these are defense-in-depth for leaked
-- anon/authenticated keys or future direct-client access patterns.

-- ============================================================
-- Cleanup: drop any partially-applied policies from previous attempts
-- ============================================================
DROP FUNCTION IF EXISTS get_current_user_id() CASCADE;
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE '%_own%' OR policyname LIKE '%_participant%' OR policyname LIKE '%_creator%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- ============================================================
-- Step 1: Auto-detect Firebase UID column + create helper function + users policies
-- ============================================================
DO $$
DECLARE
  uid_col text;
BEGIN
  -- Find the column that stores the Firebase UID on the users table
  SELECT column_name INTO uid_col
  FROM information_schema.columns
  WHERE table_name = 'users'
    AND table_schema = 'public'
    AND column_name IN ('firebase_uid', 'uid', 'auth_uid', 'auth_id', 'firebase_id')
  LIMIT 1;

  IF uid_col IS NULL THEN
    RAISE EXCEPTION 'Could not find Firebase UID column on users table. Columns found: %',
      (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
       FROM information_schema.columns
       WHERE table_name = 'users' AND table_schema = 'public');
  END IF;

  RAISE NOTICE 'Detected Firebase UID column: %', uid_col;

  -- Create helper function using detected column
  EXECUTE format('
    CREATE OR REPLACE FUNCTION get_current_user_id()
    RETURNS UUID AS $fn$
      SELECT id FROM users WHERE %I = auth.uid()::text
    $fn$ LANGUAGE sql SECURITY DEFINER STABLE;
  ', uid_col);

  -- Users policies using detected column
  EXECUTE format('CREATE POLICY users_select_own ON users FOR SELECT USING (%I = auth.uid()::text)', uid_col);
  EXECUTE format('CREATE POLICY users_update_own ON users FOR UPDATE USING (%I = auth.uid()::text)', uid_col);
  EXECUTE format('CREATE POLICY users_insert_own ON users FOR INSERT WITH CHECK (%I = auth.uid()::text)', uid_col);
END $$;

-- ============================================================
-- FCM_TOKENS — own tokens only
-- ============================================================
CREATE POLICY fcm_tokens_select_own ON fcm_tokens
  FOR SELECT USING (user_id = get_current_user_id());

CREATE POLICY fcm_tokens_insert_own ON fcm_tokens
  FOR INSERT WITH CHECK (user_id = get_current_user_id());

CREATE POLICY fcm_tokens_delete_own ON fcm_tokens
  FOR DELETE USING (user_id = get_current_user_id());

-- ============================================================
-- FRIENDSHIPS — visible to either side
-- ============================================================
CREATE POLICY friendships_select_own ON friendships
  FOR SELECT USING (
    user_a_id = get_current_user_id() OR user_b_id = get_current_user_id()
  );

CREATE POLICY friendships_insert_own ON friendships
  FOR INSERT WITH CHECK (
    invited_by = get_current_user_id()
  );

CREATE POLICY friendships_update_own ON friendships
  FOR UPDATE USING (
    user_a_id = get_current_user_id() OR user_b_id = get_current_user_id()
  );

CREATE POLICY friendships_delete_own ON friendships
  FOR DELETE USING (
    user_a_id = get_current_user_id() OR user_b_id = get_current_user_id()
  );

-- ============================================================
-- AVAILABILITY — own availability only
-- ============================================================
CREATE POLICY availability_select_own ON availability
  FOR SELECT USING (user_id = get_current_user_id());

CREATE POLICY availability_insert_own ON availability
  FOR INSERT WITH CHECK (user_id = get_current_user_id());

CREATE POLICY availability_update_own ON availability
  FOR UPDATE USING (user_id = get_current_user_id());

CREATE POLICY availability_delete_own ON availability
  FOR DELETE USING (user_id = get_current_user_id());

-- ============================================================
-- MEETUPS — visible to participants only
-- ============================================================
CREATE POLICY meetups_select_participant ON meetups
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM meetup_participants
      WHERE meetup_participants.meetup_id = meetups.id
        AND meetup_participants.user_id = get_current_user_id()
    )
  );

CREATE POLICY meetups_insert_creator ON meetups
  FOR INSERT WITH CHECK (created_by = get_current_user_id());

CREATE POLICY meetups_update_participant ON meetups
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM meetup_participants
      WHERE meetup_participants.meetup_id = meetups.id
        AND meetup_participants.user_id = get_current_user_id()
    )
  );

-- ============================================================
-- MEETUP_PARTICIPANTS — own participation + read co-participants
-- ============================================================
CREATE POLICY meetup_participants_select ON meetup_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM meetup_participants mp2
      WHERE mp2.meetup_id = meetup_participants.meetup_id
        AND mp2.user_id = get_current_user_id()
    )
  );

CREATE POLICY meetup_participants_insert ON meetup_participants
  FOR INSERT WITH CHECK (
    -- Only the meetup creator can add participants (enforced at app level too)
    EXISTS (
      SELECT 1 FROM meetups
      WHERE meetups.id = meetup_id
        AND meetups.created_by = get_current_user_id()
    )
  );

CREATE POLICY meetup_participants_update_own ON meetup_participants
  FOR UPDATE USING (user_id = get_current_user_id());

-- ============================================================
-- SUGGESTION_EVENTS — own suggestions only
-- ============================================================
CREATE POLICY suggestion_events_select_own ON suggestion_events
  FOR SELECT USING (user_id = get_current_user_id());

CREATE POLICY suggestion_events_insert_own ON suggestion_events
  FOR INSERT WITH CHECK (user_id = get_current_user_id());

CREATE POLICY suggestion_events_update_own ON suggestion_events
  FOR UPDATE USING (user_id = get_current_user_id());

-- ============================================================
-- FEEDBACK — own feedback only (auto-detect uid column)
-- ============================================================
DO $$
DECLARE
  uid_col text;
BEGIN
  -- Check if feedback table has a Firebase UID column
  SELECT column_name INTO uid_col
  FROM information_schema.columns
  WHERE table_name = 'feedback'
    AND table_schema = 'public'
    AND column_name IN ('firebase_uid', 'uid', 'auth_uid', 'auth_id', 'user_id')
  LIMIT 1;

  IF uid_col IS NULL THEN
    RAISE NOTICE 'No UID column found on feedback table — skipping feedback policies';
    RETURN;
  END IF;

  -- If it's user_id (UUID), use get_current_user_id(); otherwise match auth.uid()::text
  IF uid_col = 'user_id' THEN
    EXECUTE 'CREATE POLICY feedback_select_own ON feedback FOR SELECT USING (user_id = get_current_user_id())';
    EXECUTE 'CREATE POLICY feedback_insert_own ON feedback FOR INSERT WITH CHECK (user_id = get_current_user_id())';
  ELSE
    EXECUTE format('CREATE POLICY feedback_select_own ON feedback FOR SELECT USING (%I = auth.uid()::text)', uid_col);
    EXECUTE format('CREATE POLICY feedback_insert_own ON feedback FOR INSERT WITH CHECK (%I = auth.uid()::text)', uid_col);
  END IF;
END $$;

-- ============================================================
-- MEETUP_LOGS — own logs only
-- ============================================================
CREATE POLICY meetup_logs_select_own ON meetup_logs
  FOR SELECT USING (user_id = get_current_user_id());

CREATE POLICY meetup_logs_insert_own ON meetup_logs
  FOR INSERT WITH CHECK (user_id = get_current_user_id());

CREATE POLICY meetup_logs_update_own ON meetup_logs
  FOR UPDATE USING (user_id = get_current_user_id());

CREATE POLICY meetup_logs_delete_own ON meetup_logs
  FOR DELETE USING (user_id = get_current_user_id());

-- ============================================================
-- USER_PREFERENCES — own preferences only
-- ============================================================
CREATE POLICY user_preferences_select_own ON user_preferences
  FOR SELECT USING (user_id = get_current_user_id());

CREATE POLICY user_preferences_insert_own ON user_preferences
  FOR INSERT WITH CHECK (user_id = get_current_user_id());

CREATE POLICY user_preferences_update_own ON user_preferences
  FOR UPDATE USING (user_id = get_current_user_id());

-- ============================================================
-- USER_CALENDARS — own calendars only
-- ============================================================
CREATE POLICY user_calendars_select_own ON user_calendars
  FOR SELECT USING (user_id = get_current_user_id());

CREATE POLICY user_calendars_insert_own ON user_calendars
  FOR INSERT WITH CHECK (user_id = get_current_user_id());

CREATE POLICY user_calendars_update_own ON user_calendars
  FOR UPDATE USING (user_id = get_current_user_id());

CREATE POLICY user_calendars_delete_own ON user_calendars
  FOR DELETE USING (user_id = get_current_user_id());

-- ============================================================
-- NOTIFICATIONS — own notifications only
-- ============================================================
CREATE POLICY notifications_select_own ON notifications
  FOR SELECT USING (user_id = get_current_user_id());

CREATE POLICY notifications_insert_own ON notifications
  FOR INSERT WITH CHECK (user_id = get_current_user_id());

CREATE POLICY notifications_update_own ON notifications
  FOR UPDATE USING (user_id = get_current_user_id());

-- ============================================================
-- FRIEND_GROUPS — creator only
-- ============================================================
CREATE POLICY friend_groups_select_own ON friend_groups
  FOR SELECT USING (created_by = get_current_user_id());

CREATE POLICY friend_groups_insert_own ON friend_groups
  FOR INSERT WITH CHECK (created_by = get_current_user_id());

CREATE POLICY friend_groups_update_own ON friend_groups
  FOR UPDATE USING (created_by = get_current_user_id());

CREATE POLICY friend_groups_delete_own ON friend_groups
  FOR DELETE USING (created_by = get_current_user_id());

-- ============================================================
-- FRIEND_GROUP_MEMBERS — visible to group creator
-- ============================================================
CREATE POLICY friend_group_members_select ON friend_group_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM friend_groups
      WHERE friend_groups.id = friend_group_members.group_id
        AND friend_groups.created_by = get_current_user_id()
    )
  );

CREATE POLICY friend_group_members_insert ON friend_group_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM friend_groups
      WHERE friend_groups.id = group_id
        AND friend_groups.created_by = get_current_user_id()
    )
  );

CREATE POLICY friend_group_members_delete ON friend_group_members
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM friend_groups
      WHERE friend_groups.id = friend_group_members.group_id
        AND friend_groups.created_by = get_current_user_id()
    )
  );

-- ============================================================
-- PENDING_INVITES — inviter only
-- ============================================================
CREATE POLICY pending_invites_select_own ON pending_invites
  FOR SELECT USING (inviter_id = get_current_user_id());

CREATE POLICY pending_invites_insert_own ON pending_invites
  FOR INSERT WITH CHECK (inviter_id = get_current_user_id());

CREATE POLICY pending_invites_delete_own ON pending_invites
  FOR DELETE USING (inviter_id = get_current_user_id());

-- ============================================================
-- ACTIVITY_DISMISSALS — own dismissals only
-- ============================================================
CREATE POLICY activity_dismissals_select_own ON activity_dismissals
  FOR SELECT USING (user_id = get_current_user_id());

CREATE POLICY activity_dismissals_insert_own ON activity_dismissals
  FOR INSERT WITH CHECK (user_id = get_current_user_id());

CREATE POLICY activity_dismissals_delete_own ON activity_dismissals
  FOR DELETE USING (user_id = get_current_user_id());

-- ============================================================
-- SAVED_EVENTS — own events only
-- ============================================================
CREATE POLICY saved_events_select_own ON saved_events
  FOR SELECT USING (user_id = get_current_user_id());

CREATE POLICY saved_events_insert_own ON saved_events
  FOR INSERT WITH CHECK (user_id = get_current_user_id());

CREATE POLICY saved_events_update_own ON saved_events
  FOR UPDATE USING (user_id = get_current_user_id());

CREATE POLICY saved_events_delete_own ON saved_events
  FOR DELETE USING (user_id = get_current_user_id());

-- ============================================================
-- Enable RLS on all tables (idempotent — safe to re-run)
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fcm_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetups ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetup_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetup_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_events ENABLE ROW LEVEL SECURITY;
