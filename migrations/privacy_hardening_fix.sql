-- ============================================================
-- Privacy Hardening — Fix #1
-- ============================================================
-- 1. Removes the buggy `DELETE … RETURNING 1 INTO deleted` that would
--    error when more than one row matches. ROW_COUNT alone is enough.
-- 2. Locks down EXECUTE privileges on the purge function. By default
--    Postgres grants EXECUTE to PUBLIC; combined with SECURITY DEFINER
--    that meant anon/authenticated Supabase clients could trigger
--    destructive deletion via RPC. Now only service_role can.
-- ============================================================

BEGIN;

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
   WHERE created_at < cutoff;

  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN QUERY SELECT deleted;
END;
$$;

REVOKE ALL ON FUNCTION purge_old_suggestion_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_old_suggestion_events() FROM anon;
REVOKE ALL ON FUNCTION purge_old_suggestion_events() FROM authenticated;
GRANT EXECUTE ON FUNCTION purge_old_suggestion_events() TO service_role;

COMMIT;
