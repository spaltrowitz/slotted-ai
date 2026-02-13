-- Slotted — Database Schema (Supabase PostgreSQL)
-- Run this in the Supabase SQL Editor to bootstrap the database.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  firebase_uid    TEXT UNIQUE NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  display_name    TEXT,
  photo_url       TEXT,
  timezone        TEXT NOT NULL DEFAULT 'America/New_York',

  -- Onboarding answers
  social_frequency    TEXT,                           -- daily / 2-3-week / weekly / 2-3-month / rarely
  preferred_times     TEXT[],                         -- weekday-morning, weekend-evening, etc.
  travel_buffer_min   INT NOT NULL DEFAULT 30,
  social_battery      TEXT NOT NULL DEFAULT 'open'    -- open / ask_me / recharging
    CHECK (social_battery IN ('open', 'ask_me', 'recharging')),
  onboarded           BOOLEAN NOT NULL DEFAULT FALSE,

  -- Google Calendar
  google_access_token     TEXT,
  google_refresh_token    TEXT,
  google_token_expires_at TIMESTAMPTZ,
  calendar_watch_channel  TEXT,
  calendar_watch_expiry   TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_firebase_uid ON users (firebase_uid);

-- ============================================================
-- FRIENDSHIPS  (bidirectional, stored once per pair)
-- ============================================================
CREATE TABLE friendships (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_a_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  invited_by  UUID NOT NULL REFERENCES users(id),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_a_id, user_b_id),
  CHECK  (user_a_id < user_b_id)            -- canonical ordering
);

CREATE INDEX idx_friendships_user_a ON friendships (user_a_id);
CREATE INDEX idx_friendships_user_b ON friendships (user_b_id);

-- ============================================================
-- AVAILABILITY  (free blocks synced from Google Calendar)
-- ============================================================
CREATE TABLE availability (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_time  TIMESTAMPTZ NOT NULL,
  end_time    TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'free'
    CHECK (status IN ('free', 'busy')),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (end_time > start_time)
);

CREATE INDEX idx_availability_user_time ON availability (user_id, start_time, end_time);

-- ============================================================
-- MEETUPS
-- ============================================================
CREATE TABLE meetups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL DEFAULT 'Hangout',
  description     TEXT,
  location        TEXT,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'declined', 'cancelled')),
  created_by      UUID NOT NULL REFERENCES users(id),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MEETUP PARTICIPANTS  (many-to-many)
-- ============================================================
CREATE TABLE meetup_participants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meetup_id   UUID NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rsvp        TEXT NOT NULL DEFAULT 'pending'
    CHECK (rsvp IN ('pending', 'accepted', 'declined', 'maybe')),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (meetup_id, user_id)
);

CREATE INDEX idx_meetup_participants_user ON meetup_participants (user_id);

-- ============================================================
-- SUGGESTION EVENTS  (AI learning data — logs every suggestion)
-- ============================================================
CREATE TABLE suggestion_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  suggested_start TIMESTAMPTZ NOT NULL,
  suggested_end   TIMESTAMPTZ NOT NULL,
  day_of_week     INT NOT NULL,                    -- 0=Sun … 6=Sat
  hour_of_day     INT NOT NULL,                    -- 0–23
  social_battery  TEXT NOT NULL,                   -- snapshot at suggestion time
  score           FLOAT NOT NULL,                  -- AI confidence score

  -- Outcome (filled when user acts)
  outcome         TEXT                              -- accepted / declined / ignored
    CHECK (outcome IN ('accepted', 'declined', 'ignored', NULL)),
  acted_at        TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_suggestion_events_user ON suggestion_events (user_id, created_at);

-- ============================================================
-- Updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_friendships_updated_at
  BEFORE UPDATE ON friendships FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_meetups_updated_at
  BEFORE UPDATE ON meetups FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_meetup_participants_updated_at
  BEFORE UPDATE ON meetup_participants FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Row Level Security (RLS) — enable after setting up Supabase auth
-- ============================================================
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE meetups ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE meetup_participants ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE suggestion_events ENABLE ROW LEVEL SECURITY;
