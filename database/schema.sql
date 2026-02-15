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
  trip_buffer_before  BOOLEAN NOT NULL DEFAULT FALSE,
  trip_buffer_after   BOOLEAN NOT NULL DEFAULT TRUE,
  social_battery      TEXT NOT NULL DEFAULT 'open'    -- open / ask_me / recharging
    CHECK (social_battery IN ('open', 'ask_me', 'recharging')),
  recharging_days     INT[] DEFAULT '{}'::INT[],       -- days of week to always recharge (0=Sun, 1=Mon, ..., 6=Sat)
  onboarded           BOOLEAN NOT NULL DEFAULT FALSE,

  -- Privacy settings
  share_hangouts      BOOLEAN NOT NULL DEFAULT FALSE,  -- Share completed hangouts with friends (like Venmo feed)

  -- Call windows (recurring availability for phone/video calls)
  -- JSONB array of { day: 0-6, start: "HH:MM", end: "HH:MM", label?: string }
  call_windows        JSONB DEFAULT '[]'::JSONB,

  -- Location preferences
  neighborhood        TEXT,                         -- Home neighborhood (e.g. "West Village, NYC")
  work_neighborhood   TEXT,                         -- Work neighborhood (e.g. "Midtown, NYC")
  office_days         INT[] DEFAULT '{}'::INT[],    -- Days in office (0=Sun, 1=Mon, ..., 6=Sat)
  office_schedule_varies BOOLEAN NOT NULL DEFAULT FALSE, -- True if office schedule varies week to week

  -- Google Calendar
  google_access_token     TEXT,
  google_refresh_token    TEXT,
  google_token_expires_at TIMESTAMPTZ,
  calendar_watch_channel  TEXT,
  calendar_watch_expiry   TIMESTAMPTZ,

  -- Apple Calendar (CalDAV via iCloud)
  apple_caldav_username   TEXT,                         -- Apple ID email
  apple_caldav_password   TEXT,                         -- App-specific password (encrypted)
  apple_calendar_connected BOOLEAN NOT NULL DEFAULT FALSE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_firebase_uid ON users (firebase_uid);

-- ============================================================
-- FCM TOKENS (Firebase Cloud Messaging for push notifications)
-- ============================================================
CREATE TABLE fcm_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  device_info TEXT,                       -- Optional: browser/device info for debugging
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE (user_id, token)                -- User can have multiple tokens (different devices/browsers)
);

CREATE INDEX idx_fcm_tokens_user ON fcm_tokens (user_id);

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

  -- Per-user hangout preference (private — only visible to the setting user)
  -- 'both' = 1:1 and groups, 'one_on_one' = prefers 1:1, 'group' = prefers group hangs
  user_a_hangout_pref TEXT NOT NULL DEFAULT 'both'
    CHECK (user_a_hangout_pref IN ('both', 'one_on_one', 'group')),
  user_b_hangout_pref TEXT NOT NULL DEFAULT 'both'
    CHECK (user_b_hangout_pref IN ('both', 'one_on_one', 'group')),

  -- Per-side friendship type: local (in-person), long_distance (calls), or both
  user_a_friendship_type TEXT NOT NULL DEFAULT 'local'
    CHECK (user_a_friendship_type IN ('local', 'long_distance', 'both')),
  user_b_friendship_type TEXT NOT NULL DEFAULT 'local'
    CHECK (user_b_friendship_type IN ('local', 'long_distance', 'both')),

  -- Minimum visit duration for long-distance friends (in hours)
  -- NULL = no minimum set, applies when friendship includes in-person visits despite distance
  user_a_visit_duration_hours INT,
  user_b_visit_duration_hours INT,

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
    CHECK (status IN ('proposed', 'confirmed', 'declined', 'cancelled', 'completed', 'didnt_happen')),
  cancel_reason   TEXT
    CHECK (cancel_reason IN ('sick', 'cancelled', 'something_came_up', 'too_tired', 'scheduling_conflict', 'other', NULL)),
  reminder_sent_at TIMESTAMPTZ,
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

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, friend_id, suggested_start)
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
    CHECK (activity_type IN ('coffee', 'meal', 'drinks', 'walk', 'workout', 'movie', 'game_night', 'phone_call', 'facetime', 'video_call', 'other')),
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
-- USER CALENDARS (selected Google/Apple Calendars per user)
-- ============================================================
CREATE TABLE user_calendars (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_id     TEXT NOT NULL,                      -- Google Calendar ID or Apple CalDAV URL
  calendar_color  TEXT,                               -- hex color from provider
  is_selected     BOOLEAN NOT NULL DEFAULT TRUE,      -- user wants this calendar used for availability
  access_role     TEXT,                               -- owner, writer, reader, freeBusyReader
  source          TEXT NOT NULL DEFAULT 'google'      -- 'google' or 'apple'
    CHECK (source IN ('google', 'apple')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, calendar_id)
);

CREATE INDEX idx_user_calendars_user ON user_calendars (user_id);

CREATE TRIGGER trg_user_calendars_updated_at
  BEFORE UPDATE ON user_calendars FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- NOTIFICATIONS (in-app notifications for friend accepts, meetup requests, etc.)
-- ============================================================
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL
    CHECK (type IN ('friend_accepted', 'friend_request', 'meetup_request', 'meetup_confirmed', 'meetup_reminder', 'calendar_match')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  related_user_id UUID REFERENCES users(id) ON DELETE SET NULL,   -- e.g. the friend who accepted
  related_id      UUID,                                            -- e.g. friendship_id or meetup_id
  read            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications (user_id, read) WHERE read = FALSE;

-- ============================================================
-- FRIEND GROUPS (saved groups for recurring group scheduling)
-- ============================================================
CREATE TABLE friend_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  emoji           TEXT DEFAULT '👥',
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_friend_groups_creator ON friend_groups (created_by);

CREATE TRIGGER trg_friend_groups_updated_at
  BEFORE UPDATE ON friend_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- FRIEND GROUP MEMBERS (which friends belong to each group)
-- ============================================================
CREATE TABLE friend_group_members (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id        UUID NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (group_id, user_id)
);

CREATE INDEX idx_friend_group_members_group ON friend_group_members (group_id);
CREATE INDEX idx_friend_group_members_user ON friend_group_members (user_id);

-- ============================================================
-- PENDING INVITES (for users invited by email who haven't signed up yet)
-- ============================================================
CREATE TABLE pending_invites (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inviter_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_email   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (inviter_id, invited_email)
);

CREATE INDEX idx_pending_invites_email ON pending_invites (invited_email);
CREATE INDEX idx_pending_invites_inviter ON pending_invites (inviter_id);

-- ============================================================
-- ACTIVITY DISMISSALS (track when users dismiss activity feed items)
-- ============================================================
CREATE TABLE activity_dismissals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type   TEXT NOT NULL,                           -- 'overdue_friends', 'recent_activity', 'free_weekend'
  friend_id       UUID REFERENCES users(id) ON DELETE CASCADE, -- Optional: specific friend for this activity
  dismissed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_dismissals_user ON activity_dismissals (user_id, activity_type);
CREATE INDEX idx_activity_dismissals_friend ON activity_dismissals (user_id, friend_id);

-- ============================================================
-- MANUAL BUSY BLOCKS  (user-created busy times from dashboard)
-- ============================================================
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

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
-- RLS is enabled on all tables. The backend uses the service_role key
-- which bypasses RLS. No anon/authenticated policies are defined,
-- blocking all direct Supabase client access.
-- ============================================================
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE fcm_tokens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships          ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability         ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetup_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestion_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback             ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetup_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_calendars       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_invites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_dismissals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_busy_blocks   ENABLE ROW LEVEL SECURITY;
