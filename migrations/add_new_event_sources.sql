-- Add new event sources: eventbrite, meetup, nyc_open_data
-- Expands the saved_events.source CHECK constraint to allow new values

-- Drop the old constraint
ALTER TABLE saved_events DROP CONSTRAINT IF EXISTS saved_events_source_check;

-- Add updated constraint with all event sources
ALTER TABLE saved_events ADD CONSTRAINT saved_events_source_check 
  CHECK (source IN ('seatgeek', 'ticketmaster', 'eventbrite', 'meetup', 'nyc_open_data'));
