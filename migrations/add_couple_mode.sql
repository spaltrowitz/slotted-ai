-- Couple links — two users linked as a scheduling unit
CREATE TABLE IF NOT EXISTS couple_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_a_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'unlinked')),
  invited_by UUID NOT NULL REFERENCES users(id),
  display_name TEXT,          -- "The Smiths", "Josh & Emma", etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_a_id, user_b_id),
  CHECK (user_a_id < user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_couple_links_users ON couple_links(user_a_id, user_b_id);
ALTER TABLE couple_links ENABLE ROW LEVEL SECURITY;

-- Cached combined availability for couples (pre-computed on calendar sync)
CREATE TABLE IF NOT EXISTS couple_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  couple_id UUID NOT NULL REFERENCES couple_links(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_couple_avail ON couple_availability(couple_id, start_time, end_time);
ALTER TABLE couple_availability ENABLE ROW LEVEL SECURITY;
