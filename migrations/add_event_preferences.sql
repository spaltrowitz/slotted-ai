-- Add event preferences columns to users table
-- Run this in the Supabase SQL Editor

-- Event interests (array of categories like 'theater', 'concert', 'comedy', etc.)
ALTER TABLE users ADD COLUMN IF NOT EXISTS event_interests TEXT[] DEFAULT '{}'::TEXT[];

-- Preferred city for event discovery
ALTER TABLE users ADD COLUMN IF NOT EXISTS event_city TEXT;
