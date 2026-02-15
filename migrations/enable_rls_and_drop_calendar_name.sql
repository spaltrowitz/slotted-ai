-- ============================================================
-- Migration: Enable RLS on all tables + drop calendar_name
-- ============================================================
-- The backend uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS,
-- so existing server-side queries keep working. RLS blocks any
-- direct access via the anon key or authenticated client tokens.
-- ============================================================

-- 1. Enable RLS on every table
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE fcm_tokens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships          ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability         ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetup_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestion_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback             ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetup_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_calendars       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_invites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_dismissals  ENABLE ROW LEVEL SECURITY;

-- Tables from migrations (may or may not exist yet)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'saved_events') THEN
    ALTER TABLE saved_events ENABLE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_invites') THEN
    ALTER TABLE event_invites ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- 2. No anon/authenticated policies → only the service_role key
--    (used by our Firebase Functions backend) can access data.
--    If you later add a Supabase client in the frontend, add
--    row-scoped policies here.

-- 3. Drop the human-readable calendar name (privacy: we only need
--    the calendar_id to track selection, not names like "Work" or "Personal")
ALTER TABLE user_calendars DROP COLUMN IF EXISTS calendar_name;
