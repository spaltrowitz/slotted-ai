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
-- FEEDBACK
-- ============================================================
CREATE TABLE feedback (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  firebase_uid    TEXT NOT NULL,
  email           TEXT NOT NULL,
  display_name    TEXT,
  message         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_created ON feedback(created_at DESC);

-- ============================================================
-- MEETUP LOGS (progressive profiling — learning data)
-- ============================================================
CREATE TABLE meetup_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id       UUID REFERENCES users(id) ON DELETE SET NULL,

  -- What happened
  activity_type   TEXT NOT NULL DEFAULT 'other'
    CHECK (activity_type IN ('coffee', 'meal', 'drinks', 'walk', 'workout', 'movie', 'game_night', 'hangout', 'other')),
  duration_min    INT,                                 -- actual duration in minutes
  day_of_week     INT NOT NULL,                        -- 0=Sun … 6=Sat
  time_of_day     TEXT NOT NULL                        -- morning, afternoon, evening, night
    CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'night')),
  
  -- Planning style
  notice_days     INT,                                 -- how many days in advance it was planned
  was_spontaneous BOOLEAN NOT NULL DEFAULT FALSE,      -- planned < 24h ahead
  
  -- User sentiment
  rating          INT CHECK (rating BETWEEN 1 AND 5),  -- optional: how'd it go?
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meetup_logs_user ON meetup_logs (user_id, created_at);
CREATE INDEX idx_meetup_logs_activity ON meetup_logs (user_id, activity_type);

-- ============================================================
-- USER PREFERENCES (learned from meetup_logs — cached patterns)
-- ============================================================
CREATE TABLE user_preferences (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Learned patterns (updated after each meetup log)
  preferred_activity    TEXT,           -- most common activity_type
  avg_duration_min      INT,           -- average meetup duration
  preferred_time        TEXT,          -- most common time_of_day
  preferred_day         TEXT,          -- most common day name
  planning_style        TEXT           -- 'spontaneous' | 'planner' | 'mixed'
    CHECK (planning_style IN ('spontaneous', 'planner', 'mixed', NULL)),
  total_meetups_logged  INT NOT NULL DEFAULT 0,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_prefs_user ON user_preferences (user_id);

-- ============================================================
-- Row Level Security (RLS) — enable after setting up Supabase auth
-- ============================================================
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE meetups ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE meetup_participants ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE suggestion_events ENABLE ROW LEVEL SECURITY;
