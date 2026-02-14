-- Add google_event_id to meetup_participants for calendar sync tracking
ALTER TABLE meetup_participants ADD COLUMN IF NOT EXISTS google_event_id TEXT;
