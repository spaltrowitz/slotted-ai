-- SMS pending actions — tracks what reply we expect from each phone number
CREATE TABLE IF NOT EXISTS sms_pending_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_pending_phone ON sms_pending_actions(phone_number);
CREATE INDEX IF NOT EXISTS idx_sms_pending_user ON sms_pending_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_pending_expires ON sms_pending_actions(expires_at);

ALTER TABLE sms_pending_actions ENABLE ROW LEVEL SECURITY;

-- SMS opt-outs — users who replied STOP
CREATE TABLE IF NOT EXISTS sms_opt_outs (
  phone_number TEXT PRIMARY KEY,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sms_opt_outs ENABLE ROW LEVEL SECURITY;

-- Add phone_number column to users table for SMS delivery
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT;
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number) WHERE phone_number IS NOT NULL;
