-- Run this in Supabase SQL Editor to check activity feed setup

-- 1. Check if activity_dismissals table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'activity_dismissals'
) AS activity_dismissals_exists;

-- 2. Check if you have any completed meetups (needed for "overdue friends" activity)
SELECT COUNT(*) as completed_meetups_count
FROM meetups
WHERE status = 'completed';

-- 3. Check if you have any meetup_logs (needed for "recent activity" feed)
SELECT COUNT(*) as meetup_logs_count
FROM meetup_logs
WHERE created_at >= NOW() - INTERVAL '7 days';

-- 4. If activity_dismissals doesn't exist, create it:
-- (Uncomment and run if the first query returned false)
/*
CREATE TABLE IF NOT EXISTS activity_dismissals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type   TEXT NOT NULL,
  friend_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_dismissals_user ON activity_dismissals (user_id, activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_dismissals_friend ON activity_dismissals (user_id, friend_id);
*/
