-- Allow owner-driven manual settlement provenance for event schedule polls.

ALTER TABLE event_schedules
  DROP CONSTRAINT IF EXISTS event_schedules_confirmed_source_check;

ALTER TABLE event_schedules
  ADD CONSTRAINT event_schedules_confirmed_source_check
  CHECK (
    confirmed_source IS NULL
    OR confirmed_source IN ('event_poll', 'admin', 'manual_settle')
  );
