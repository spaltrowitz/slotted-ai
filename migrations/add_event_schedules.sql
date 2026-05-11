-- Event schedule polls — stores selected showtimes for group voting
CREATE TABLE IF NOT EXISTS event_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_title TEXT NOT NULL,
  event_venue TEXT,
  event_image_url TEXT,
  event_url TEXT,
  showtimes JSONB NOT NULL DEFAULT '[]'::JSONB,
  friend_ids UUID[] NOT NULL DEFAULT '{}',
  invites_closed BOOLEAN NOT NULL DEFAULT FALSE,
  invites_closed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'voting'
    CHECK (status IN ('voting', 'confirmed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

CREATE INDEX idx_event_schedules_creator ON event_schedules(created_by);

-- Votes on event schedule showtimes
CREATE TABLE IF NOT EXISTS event_schedule_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES event_schedules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selected_indices INT[] NOT NULL DEFAULT '{}',
  voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schedule_id, user_id)
);

CREATE INDEX idx_event_schedule_votes_schedule ON event_schedule_votes(schedule_id);

ALTER TABLE event_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_schedule_votes ENABLE ROW LEVEL SECURITY;
