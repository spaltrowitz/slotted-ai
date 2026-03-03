-- Migration: two-way calendar sync (Phase 1 + 2)

-- 1. Sync token for incremental sync
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_sync_token TEXT;

-- 2. Resource ID needed to stop watch channels
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_watch_resource_id TEXT;

-- 3. Track when each participant's GCal event was last synced
ALTER TABLE meetup_participants
  ADD COLUMN IF NOT EXISTS gcal_etag TEXT,
  ADD COLUMN IF NOT EXISTS gcal_last_synced_at TIMESTAMPTZ;

-- 4. Track sync-originated RSVP changes to prevent feedback loops
ALTER TABLE meetup_participants
  ADD COLUMN IF NOT EXISTS rsvp_source TEXT DEFAULT 'app'
    CHECK (rsvp_source IN ('app', 'google_calendar', 'apple_calendar'));

-- 5. Remove notification type CHECK constraint — app-level validation is sufficient
-- The constraint kept going stale as new notification types were added in code.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
