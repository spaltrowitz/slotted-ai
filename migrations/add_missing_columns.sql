-- Migration: Add ALL missing columns to the database
-- Run this in Supabase SQL Editor
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS everywhere

-- ============================================
-- USERS TABLE: Core onboarding columns
-- (These should exist from initial schema but may be missing)
-- ============================================

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS social_frequency TEXT;

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS preferred_times TEXT[];

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS travel_buffer_min INT NOT NULL DEFAULT 30;

-- social_battery with CHECK constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'social_battery'
  ) THEN
    ALTER TABLE users ADD COLUMN social_battery TEXT NOT NULL DEFAULT 'open';
    ALTER TABLE users ADD CONSTRAINT users_social_battery_check 
      CHECK (social_battery IN ('open', 'ask_me', 'recharging'));
  END IF;
END $$;

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS recharging_days INT[] DEFAULT '{}'::INT[];

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT FALSE;

-- Planning style on users table (used by settings endpoint)
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS planning_style TEXT DEFAULT 'flexible';

-- ============================================
-- USERS TABLE: Settings page features
-- ============================================

-- Trip buffer toggles (before/after travel)
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS trip_buffer_before BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS trip_buffer_after BOOLEAN NOT NULL DEFAULT TRUE;

-- Privacy: Share completed hangouts with friends
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS share_hangouts BOOLEAN NOT NULL DEFAULT FALSE;

-- Location preferences
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS neighborhood TEXT;

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS work_neighborhood TEXT;

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS office_days INT[] DEFAULT '{}'::INT[];

-- Office schedule variability flag
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS office_schedule_varies BOOLEAN NOT NULL DEFAULT FALSE;

-- Call windows for phone/video availability
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS call_windows JSONB DEFAULT '[]'::JSONB;

-- ============================================
-- USERS TABLE: Apple Calendar (CalDAV) support
-- ============================================

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS apple_caldav_username TEXT;

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS apple_caldav_password TEXT;

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS apple_calendar_connected BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================
-- FRIENDSHIPS TABLE: Visit duration feature
-- ============================================

-- Minimum visit duration for long-distance friends (in hours)
ALTER TABLE friendships 
  ADD COLUMN IF NOT EXISTS user_a_visit_duration_hours INT;

ALTER TABLE friendships 
  ADD COLUMN IF NOT EXISTS user_b_visit_duration_hours INT;

-- ============================================
-- MEETUP_LOGS TABLE: Remove 'hangout' from activity types
-- ============================================

-- Drop old constraint
ALTER TABLE meetup_logs 
  DROP CONSTRAINT IF EXISTS meetup_logs_activity_type_check;

-- Add new constraint without 'hangout'
ALTER TABLE meetup_logs 
  ADD CONSTRAINT meetup_logs_activity_type_check 
  CHECK (activity_type IN ('coffee', 'meal', 'drinks', 'walk', 'workout', 'movie', 'game_night', 'phone_call', 'facetime', 'video_call', 'other'));

-- ============================================
-- ACTIVITY DISMISSALS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS activity_dismissals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type   TEXT NOT NULL,
  friend_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_dismissals_user ON activity_dismissals (user_id, activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_dismissals_friend ON activity_dismissals (user_id, friend_id);

-- ============================================
-- USER_CALENDARS TABLE: Multi-provider support
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_calendars') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'user_calendars' AND column_name = 'source'
    ) THEN
      ALTER TABLE user_calendars ADD COLUMN source TEXT NOT NULL DEFAULT 'google';
    END IF;
  END IF;
END $$;

-- Done! All columns added.
