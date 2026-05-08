-- Recurring meetup templates
CREATE TABLE IF NOT EXISTS recurring_meetups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  activity_type TEXT,
  frequency TEXT NOT NULL DEFAULT 'biweekly'
    CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  preferred_day INT,            -- 0=Sun ... 6=Sat
  preferred_time TEXT,          -- "morning", "afternoon", "evening"
  duration_min INT DEFAULT 60,
  participant_ids UUID[] NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_scheduled_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_creator ON recurring_meetups(created_by);
CREATE INDEX IF NOT EXISTS idx_recurring_next ON recurring_meetups(next_check_at) WHERE is_active = TRUE;
ALTER TABLE recurring_meetups ENABLE ROW LEVEL SECURITY;
