-- Track which lifecycle messages have been sent to each user
CREATE TABLE IF NOT EXISTS sms_lifecycle_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL,  -- 'welcome', 'invite_friend', 'first_meetup', 'reactivation', 'monthly_recap', 'beta_blast'
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, message_type)  -- each lifecycle message sent at most once
);

CREATE INDEX IF NOT EXISTS idx_sms_lifecycle_user ON sms_lifecycle_log(user_id);
ALTER TABLE sms_lifecycle_log ENABLE ROW LEVEL SECURITY;

-- Track SMS send volume per user per week (for rate limiting)
CREATE TABLE IF NOT EXISTS sms_weekly_counts (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,  -- Monday of the week
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, week_start)
);

ALTER TABLE sms_weekly_counts ENABLE ROW LEVEL SECURITY;
