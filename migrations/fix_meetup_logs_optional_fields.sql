-- Make meetup_logs fields optional (all fields except user_id should be nullable)
-- This allows users to save a hangout with just a date, or just a friend, etc.

-- Make day_of_week nullable
ALTER TABLE meetup_logs ALTER COLUMN day_of_week DROP NOT NULL;

-- Make time_of_day nullable
ALTER TABLE meetup_logs ALTER COLUMN time_of_day DROP NOT NULL;

-- Make activity_type nullable (was NOT NULL DEFAULT 'other')
ALTER TABLE meetup_logs ALTER COLUMN activity_type DROP NOT NULL;
