-- Outlook Calendar Integration
-- Add Outlook credential columns to users table and update user_calendars source constraint

-- Add Outlook credential columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_token_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_calendar_connected BOOLEAN NOT NULL DEFAULT FALSE;

-- Update user_calendars source constraint to include 'outlook'
ALTER TABLE user_calendars DROP CONSTRAINT IF EXISTS user_calendars_source_check;
ALTER TABLE user_calendars ADD CONSTRAINT user_calendars_source_check 
  CHECK (source IN ('google', 'apple', 'outlook'));
