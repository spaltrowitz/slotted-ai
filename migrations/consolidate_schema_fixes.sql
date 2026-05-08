-- Migration: Schema consolidation fixes
-- Adds missing indexes, notification type constraint, cancel reason soft language,
-- and updated_at triggers for tables missing them.
-- Idempotent: safe to re-run.

-- ============================================================
-- 1. Cancel reason soft language rename
-- ============================================================
-- Update existing data first, then replace the constraint.
UPDATE meetups SET cancel_reason = 'changed_plans' WHERE cancel_reason = 'cancelled';
UPDATE meetups SET cancel_reason = 'need_rest' WHERE cancel_reason = 'too_tired';

ALTER TABLE meetups DROP CONSTRAINT IF EXISTS meetups_cancel_reason_check;
ALTER TABLE meetups ADD CONSTRAINT meetups_cancel_reason_check
  CHECK (cancel_reason IN ('sick', 'changed_plans', 'something_came_up', 'need_rest', 'scheduling_conflict', 'other', NULL));

-- ============================================================
-- 2. Notification type CHECK constraint
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'friend_accepted', 'friend_request',
    'meetup_request', 'meetup_confirmed', 'meetup_declined',
    'meetup_reminder', 'meetup_rsvp_changed', 'meetup_time_changed',
    'meetup_counter_propose', 'meetup_counter_proposed',
    'calendar_match'
  ));

-- ============================================================
-- 3. Add updated_at column to notifications (if missing)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'notifications' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE notifications ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

-- ============================================================
-- 4. Missing indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships (status);
CREATE INDEX IF NOT EXISTS idx_meetups_start_time ON meetups (start_time);
CREATE INDEX IF NOT EXISTS idx_meetups_created_at ON meetups (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications (type);
CREATE INDEX IF NOT EXISTS idx_meetup_logs_friend ON meetup_logs (friend_id, created_at DESC);

-- ============================================================
-- 5. Missing updated_at triggers
-- ============================================================
CREATE OR REPLACE TRIGGER trg_fcm_tokens_updated_at
  BEFORE UPDATE ON fcm_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at();
