-- ============================================================
-- Migration: Privacy hardening
-- ============================================================
-- Adds defense-in-depth around the public privacy claims:
--   "Friends never see your battery, your free blocks, or your sync status."
--   "We only see free or busy — never event titles or details."
--
-- DB schema is already privacy-clean at rest (only start_time/end_time/status
-- live in `availability`; OAuth tokens live in vault; RLS enabled everywhere
-- with service-role-only access). This migration adds two safety nets:
--
--   1. A `friend_public_view` that exposes ONLY the columns safe to share
--      between friends. Backend code should query this view (not `users.*`)
--      when fetching a friend's profile, so even a future bug can't leak
--      `social_battery`, `email`, `firebase_uid`, etc.
--
--   2. A scheduled purge of `suggestion_events` older than 90 days. The
--      schema's design comment already calls for this; it's now enforced.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Friend-safe profile view
-- ------------------------------------------------------------
-- Columns intentionally excluded:
--   social_battery   — private signal, never visible to friends
--   email            — PII not needed for friend display
--   firebase_uid     — auth identifier, never leaves the server
--   invite_code      — only meaningful to the owner
--   social_frequency, planning_style, etc. — personal scheduling prefs
--
-- Columns included are exactly the ones FriendsPage / DashboardPage / etc.
-- already render: name, photo, neighborhood (for local/long-distance routing),
-- timezone (for call windows), event_interests (for shared-interest pills).
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW friend_public_view AS
SELECT
  id,
  display_name,
  photo_url,
  neighborhood,
  timezone,
  event_interests
FROM users;

COMMENT ON VIEW friend_public_view IS
  'Privacy-safe projection of users. Backend MUST use this (not users.*) when '
  'fetching a friend''s profile. Excludes social_battery, email, firebase_uid, '
  'and all personal scheduling preferences. See landing-page privacy claims.';

-- Lock it down. The view inherits RLS from the underlying table, but we
-- also revoke direct access to be explicit.
REVOKE ALL ON friend_public_view FROM PUBLIC;
REVOKE ALL ON friend_public_view FROM anon;
REVOKE ALL ON friend_public_view FROM authenticated;
-- service_role retains access (it bypasses RLS anyway).

-- ------------------------------------------------------------
-- 2. Retention policy for suggestion_events
-- ------------------------------------------------------------
-- suggestion_events is AI training data. It includes a snapshot of
-- social_battery at suggestion time, so retention matters. The schema
-- comment already specifies a 90-day retention window; this enforces it.
--
-- Uses pg_cron if available; falls back to a manually-callable function
-- so the team can run it from the SQL editor or wire it to a Firebase
-- scheduled function.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_old_suggestion_events()
RETURNS TABLE(deleted_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := now() - interval '90 days';
  deleted bigint;
BEGIN
  DELETE FROM suggestion_events
   WHERE created_at < cutoff
   RETURNING 1 INTO deleted;

  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN QUERY SELECT deleted;
END;
$$;

COMMENT ON FUNCTION purge_old_suggestion_events() IS
  'Deletes suggestion_events older than 90 days. Run via pg_cron or a '
  'Firebase scheduled function. Enforces the retention policy declared '
  'in the schema header for the suggestion_events table.';

-- If pg_cron is installed, schedule the purge daily at 03:17 UTC.
-- (Wrapped in DO so the migration succeeds on projects without pg_cron.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge_old_suggestion_events_daily',
      '17 3 * * *',
      $cron$ SELECT purge_old_suggestion_events(); $cron$
    );
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 3. Column-level documentation for sensitive fields
-- ------------------------------------------------------------
-- Catches accidental SELECT * leaks in code review by tagging the columns
-- that must never be returned to other users.
-- ------------------------------------------------------------
COMMENT ON COLUMN users.social_battery IS
  'PRIVATE. Never expose to other users. Used only as an input to the '
  'AI scoring engine. Public claim: "Friends never see your battery."';

COMMENT ON COLUMN users.email IS
  'PRIVATE. PII. Never include in friend-facing API responses.';

COMMENT ON COLUMN users.firebase_uid IS
  'PRIVATE. Auth identifier. Server-only.';

COMMENT ON TABLE availability IS
  'Stores ONLY (user_id, start_time, end_time, status). Event titles, '
  'descriptions, locations, and attendees from Google/Apple/Outlook are '
  'read in-memory during sync but NEVER persisted. Public claim: '
  '"We only see free or busy — never event titles or details."';

COMMIT;
