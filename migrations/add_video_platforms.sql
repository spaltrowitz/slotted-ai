-- Add video_platforms array column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS video_platforms TEXT[] DEFAULT '{}';
