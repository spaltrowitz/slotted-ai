-- Migration: Add event interest preferences and saved events
-- Run in Supabase SQL Editor

-- ============================================================
-- EVENT INTERESTS (user preferences for event types)
-- Stored as JSONB on users table for simplicity
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS event_interests TEXT[] DEFAULT '{}'::TEXT[];
-- Values: 'theater', 'concerts', 'sports', 'comedy', 'festivals', 'dance', 'opera', 'family'

ALTER TABLE users ADD COLUMN IF NOT EXISTS event_city TEXT;
-- Default city for event searches (e.g. "New York")

-- ============================================================
-- SAVED EVENTS (bookmarked events from search results)
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Event data (denormalized from external APIs)
  external_id     TEXT NOT NULL,                       -- SeatGeek or Ticketmaster event ID
  source          TEXT NOT NULL CHECK (source IN ('seatgeek', 'ticketmaster')),
  title           TEXT NOT NULL,
  event_type      TEXT,                                -- theater, concert, sports, etc.
  venue           TEXT,
  city            TEXT,
  datetime_utc    TIMESTAMPTZ NOT NULL,
  datetime_local  TEXT,                                -- Local datetime string
  url             TEXT NOT NULL,                       -- Ticket purchase URL
  image_url       TEXT,
  price_min       NUMERIC(10,2),
  price_max       NUMERIC(10,2),
  performers      TEXT[],
  
  -- User interaction
  status          TEXT NOT NULL DEFAULT 'saved'
    CHECK (status IN ('saved', 'interested', 'going', 'went', 'dismissed')),
  notes           TEXT,                                -- User's personal notes
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE (user_id, external_id, source)
);

CREATE INDEX idx_saved_events_user ON saved_events (user_id, status);
CREATE INDEX idx_saved_events_datetime ON saved_events (user_id, datetime_utc);

CREATE TRIGGER trg_saved_events_updated_at
  BEFORE UPDATE ON saved_events FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- EVENT INVITES (invite friends to saved events)
-- ============================================================
CREATE TABLE IF NOT EXISTS event_invites (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  saved_event_id  UUID NOT NULL REFERENCES saved_events(id) ON DELETE CASCADE,
  invited_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rsvp            TEXT NOT NULL DEFAULT 'pending'
    CHECK (rsvp IN ('pending', 'interested', 'going', 'declined')),
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE (saved_event_id, invited_user_id)
);

CREATE INDEX idx_event_invites_user ON event_invites (invited_user_id, rsvp);
CREATE INDEX idx_event_invites_event ON event_invites (saved_event_id);

CREATE TRIGGER trg_event_invites_updated_at
  BEFORE UPDATE ON event_invites FOR EACH ROW EXECUTE FUNCTION update_updated_at();
