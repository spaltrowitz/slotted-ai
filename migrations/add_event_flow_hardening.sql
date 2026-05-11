-- Event poll lifecycle hardening: expiry, provenance, and duplicate confirmation guards

ALTER TABLE event_schedules
  ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE event_schedules
  ADD COLUMN IF NOT EXISTS confirmed_source TEXT
    CHECK (confirmed_source IN ('event_poll', 'admin', NULL));

ALTER TABLE event_schedules
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

ALTER TABLE event_schedules
  ADD COLUMN IF NOT EXISTS confirmed_showtime_index INT;

ALTER TABLE event_schedules
  ADD COLUMN IF NOT EXISTS confirmed_meetup_id UUID REFERENCES meetups(id) ON DELETE SET NULL;

ALTER TABLE meetups
  ADD COLUMN IF NOT EXISTS source_event_schedule_id UUID REFERENCES event_schedules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_schedules_expiry
  ON event_schedules(status, expires_at)
  WHERE status = 'voting';

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_schedules_confirmed_meetup
  ON event_schedules(confirmed_meetup_id)
  WHERE confirmed_meetup_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meetups_source_event_schedule
  ON meetups(source_event_schedule_id)
  WHERE source_event_schedule_id IS NOT NULL;
