-- Migration: Add manual busy blocks table
-- Users can mark specific times as busy on the dashboard calendar
-- These blocks feed into the availability engine alongside calendar synced data

CREATE TABLE manual_busy_blocks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_time  TIMESTAMPTZ NOT NULL,
  end_time    TIMESTAMPTZ NOT NULL,
  label       TEXT,                                      -- optional label like "Dinner plans" or "Busy"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (end_time > start_time)
);

CREATE INDEX idx_manual_busy_blocks_user_time ON manual_busy_blocks (user_id, start_time, end_time);

ALTER TABLE manual_busy_blocks ENABLE ROW LEVEL SECURITY;
