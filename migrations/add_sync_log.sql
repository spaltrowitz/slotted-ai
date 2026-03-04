-- sync_log: tracks calendar sync outcomes for monitoring
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'apple', 'outlook')),
  status text NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  slots_synced integer DEFAULT 0,
  error_message text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_log_user_id ON sync_log(user_id);
CREATE INDEX idx_sync_log_created_at ON sync_log(created_at DESC);
CREATE INDEX idx_sync_log_status ON sync_log(status) WHERE status = 'error';

-- RLS: only admins can read sync logs (service role bypasses RLS)
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE sync_log IS 'Tracks calendar sync outcomes per provider for monitoring and debugging';
