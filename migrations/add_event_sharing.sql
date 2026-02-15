-- Add event sharing support to notifications
-- Run this in the Supabase SQL Editor

-- 1. Update the type constraint to allow 'event_shared'
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check 
  CHECK (type IN (
    'friend_accepted', 'friend_request', 
    'meetup_request', 'meetup_confirmed', 'meetup_reminder', 
    'calendar_match', 'event_shared'
  ));

-- 2. Add metadata JSONB column for rich data (event details, URLs, images)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB;
