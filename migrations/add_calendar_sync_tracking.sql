-- Migration: Add calendar sync tracking columns for two-way sync
-- Google Calendar watch channels need resource_id for stopping channels
-- Sync token tracks incremental sync state for efficient change detection

-- Google Calendar sync token for incremental sync (events.list syncToken)
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_sync_token TEXT;

-- Google Calendar watch resource_id (needed to stop/renew channels)
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_watch_resource_id TEXT;

-- Track calendar source on meetup_participants (which calendar the event was added to)
ALTER TABLE meetup_participants ADD COLUMN IF NOT EXISTS calendar_source TEXT
  CHECK (calendar_source IN ('google', 'apple', NULL));

-- Track last Apple CalDAV poll time per user for efficient polling
ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_last_sync_at TIMESTAMPTZ;
