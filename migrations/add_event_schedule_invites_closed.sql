-- Require host confirmation that everyone has been invited before a poll is ready to finalize
ALTER TABLE event_schedules
  ADD COLUMN IF NOT EXISTS invites_closed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE event_schedules
  ADD COLUMN IF NOT EXISTS invites_closed_at TIMESTAMPTZ;
