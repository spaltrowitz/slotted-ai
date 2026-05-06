-- Migration: Encrypt OAuth tokens at rest using Supabase Vault
-- Moves plaintext token columns from `users` into Vault-backed `oauth_tokens` table.
-- The backend (service_role) calls helper SQL functions to read/write tokens.
--
-- Prerequisites: pgsodium extension enabled in Supabase dashboard (provides vault schema).
-- Idempotent: safe to re-run; uses IF NOT EXISTS / ON CONFLICT where possible.

-- ============================================================
-- 1. Create the oauth_tokens table
-- ============================================================
-- Stores one row per user+provider. Sensitive values live in vault.secrets;
-- this table holds the vault secret UUID references plus non-sensitive metadata.

CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('google', 'outlook', 'apple')),
  secret_id     UUID NOT NULL,       -- FK to vault.secrets(id)
  token_expires_at TIMESTAMPTZ,      -- non-sensitive expiry timestamp
  caldav_username  TEXT,              -- non-sensitive Apple CalDAV email
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_provider
  ON oauth_tokens (provider);

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- RLS: service_role bypasses RLS. For authenticated users, owner-only access.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'oauth_tokens' AND policyname = 'oauth_tokens_owner_select'
  ) THEN
    CREATE POLICY oauth_tokens_owner_select ON oauth_tokens
      FOR SELECT USING (user_id = (SELECT id FROM users WHERE firebase_uid = auth.uid()::text));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'oauth_tokens' AND policyname = 'oauth_tokens_owner_all'
  ) THEN
    CREATE POLICY oauth_tokens_owner_all ON oauth_tokens
      FOR ALL USING (user_id = (SELECT id FROM users WHERE firebase_uid = auth.uid()::text));
  END IF;
END $$;


-- ============================================================
-- 2. Helper functions (SECURITY DEFINER — callable via service_role RPC)
-- ============================================================

-- 2a. Upsert tokens for a user+provider
-- Stores sensitive fields as a JSON vault secret. Merges with existing secret
-- so callers can update individual fields without overwriting others.
CREATE OR REPLACE FUNCTION upsert_oauth_tokens(
  p_user_id          UUID,
  p_provider         TEXT,
  p_access_token     TEXT DEFAULT NULL,
  p_refresh_token    TEXT DEFAULT NULL,
  p_token_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_caldav_username  TEXT DEFAULT NULL,
  p_caldav_password  TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_existing_secret_id UUID;
  v_existing_json      JSONB := '{}'::jsonb;
  v_new_json           JSONB;
  v_new_secret_id      UUID;
  v_secret_name        TEXT;
BEGIN
  v_secret_name := 'oauth:' || p_user_id::text || ':' || p_provider;

  -- Check for existing row
  SELECT secret_id INTO v_existing_secret_id
    FROM oauth_tokens
   WHERE user_id = p_user_id AND provider = p_provider;

  -- If existing, read current decrypted secret to merge
  IF v_existing_secret_id IS NOT NULL THEN
    SELECT COALESCE(decrypted_secret, '{}')::jsonb INTO v_existing_json
      FROM vault.decrypted_secrets
     WHERE id = v_existing_secret_id;
  END IF;

  -- Build merged JSON — only override fields that are explicitly provided
  v_new_json := v_existing_json;
  IF p_access_token  IS NOT NULL THEN v_new_json := v_new_json || jsonb_build_object('access_token', p_access_token); END IF;
  IF p_refresh_token IS NOT NULL THEN v_new_json := v_new_json || jsonb_build_object('refresh_token', p_refresh_token); END IF;
  IF p_caldav_password IS NOT NULL THEN v_new_json := v_new_json || jsonb_build_object('caldav_password', p_caldav_password); END IF;

  IF v_existing_secret_id IS NOT NULL THEN
    -- Update the existing vault secret in-place
    PERFORM vault.update_secret(
      v_existing_secret_id,
      v_new_json::text,
      v_secret_name,
      'OAuth tokens for ' || p_provider
    );

    UPDATE oauth_tokens
       SET token_expires_at = COALESCE(p_token_expires_at, token_expires_at),
           caldav_username  = COALESCE(p_caldav_username, caldav_username),
           updated_at       = NOW()
     WHERE user_id = p_user_id AND provider = p_provider;
  ELSE
    -- Create new vault secret
    v_new_secret_id := vault.create_secret(
      v_new_json::text,
      v_secret_name,
      'OAuth tokens for ' || p_provider
    );

    INSERT INTO oauth_tokens (user_id, provider, secret_id, token_expires_at, caldav_username)
    VALUES (p_user_id, p_provider, v_new_secret_id, p_token_expires_at, p_caldav_username);
  END IF;
END;
$$;

-- 2b. Read decrypted tokens for a user+provider
-- Returns a single row with the decrypted token fields.
CREATE OR REPLACE FUNCTION get_oauth_tokens(
  p_user_id  UUID,
  p_provider TEXT
) RETURNS TABLE (
  access_token     TEXT,
  refresh_token    TEXT,
  caldav_password  TEXT,
  token_expires_at TIMESTAMPTZ,
  caldav_username  TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id UUID;
  v_json      JSONB;
  v_expires   TIMESTAMPTZ;
  v_username  TEXT;
BEGIN
  SELECT ot.secret_id, ot.token_expires_at, ot.caldav_username
    INTO v_secret_id, v_expires, v_username
    FROM oauth_tokens ot
   WHERE ot.user_id = p_user_id AND ot.provider = p_provider;

  IF v_secret_id IS NULL THEN
    RETURN;  -- no row = no tokens
  END IF;

  SELECT COALESCE(ds.decrypted_secret, '{}')::jsonb INTO v_json
    FROM vault.decrypted_secrets ds
   WHERE ds.id = v_secret_id;

  RETURN QUERY SELECT
    (v_json->>'access_token')::TEXT,
    (v_json->>'refresh_token')::TEXT,
    (v_json->>'caldav_password')::TEXT,
    v_expires,
    v_username;
END;
$$;

-- 2c. Read all providers' tokens for a user (used by getDbUser overlay)
CREATE OR REPLACE FUNCTION get_all_user_oauth_tokens(
  p_user_id UUID
) RETURNS TABLE (
  provider         TEXT,
  access_token     TEXT,
  refresh_token    TEXT,
  caldav_password  TEXT,
  token_expires_at TIMESTAMPTZ,
  caldav_username  TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, vault
AS $$
DECLARE
  r RECORD;
  v_json JSONB;
BEGIN
  FOR r IN
    SELECT ot.provider AS prov, ot.secret_id, ot.token_expires_at AS expires, ot.caldav_username AS uname
      FROM oauth_tokens ot
     WHERE ot.user_id = p_user_id
  LOOP
    SELECT COALESCE(ds.decrypted_secret, '{}')::jsonb INTO v_json
      FROM vault.decrypted_secrets ds
     WHERE ds.id = r.secret_id;

    provider         := r.prov;
    access_token     := (v_json->>'access_token')::TEXT;
    refresh_token    := (v_json->>'refresh_token')::TEXT;
    caldav_password  := (v_json->>'caldav_password')::TEXT;
    token_expires_at := r.expires;
    caldav_username  := r.uname;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 2d. Clear tokens for a user+provider (disconnect flow)
CREATE OR REPLACE FUNCTION clear_oauth_tokens(
  p_user_id  UUID,
  p_provider TEXT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT secret_id INTO v_secret_id
    FROM oauth_tokens
   WHERE user_id = p_user_id AND provider = p_provider;

  IF v_secret_id IS NOT NULL THEN
    -- Delete from vault first (FK-safe: oauth_tokens just references by UUID, no real FK)
    DELETE FROM vault.secrets WHERE id = v_secret_id;
    DELETE FROM oauth_tokens WHERE user_id = p_user_id AND provider = p_provider;
  END IF;
END;
$$;

-- 2e. Check which providers a user has tokens for (used in sync queries)
CREATE OR REPLACE FUNCTION users_with_oauth_provider(
  p_provider TEXT
) RETURNS TABLE (user_id UUID)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT ot.user_id FROM oauth_tokens ot WHERE ot.provider = p_provider;
$$;


-- ============================================================
-- 3. Migrate existing plaintext tokens to Vault
-- ============================================================
-- This block reads current plaintext columns (if they exist) and stores
-- them as vault secrets. It's written defensively so it handles schema
-- drift — if columns don't exist, the migration simply skips.

DO $$
DECLARE
  r RECORD;
  v_has_google_col BOOLEAN;
  v_has_outlook_col BOOLEAN;
  v_has_apple_col BOOLEAN;
BEGIN
  -- Detect which plaintext columns actually exist in the live schema
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'google_access_token'
  ) INTO v_has_google_col;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'outlook_access_token'
  ) INTO v_has_outlook_col;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'apple_caldav_password'
  ) INTO v_has_apple_col;

  -- Migrate Google tokens
  IF v_has_google_col THEN
    FOR r IN
      SELECT id, google_access_token, google_refresh_token, google_token_expires_at
        FROM users
       WHERE google_access_token IS NOT NULL OR google_refresh_token IS NOT NULL
    LOOP
      -- Skip if already migrated
      IF NOT EXISTS (SELECT 1 FROM oauth_tokens WHERE user_id = r.id AND provider = 'google') THEN
        PERFORM upsert_oauth_tokens(
          r.id, 'google',
          r.google_access_token,
          r.google_refresh_token,
          r.google_token_expires_at,
          NULL, NULL
        );
      END IF;
    END LOOP;
  END IF;

  -- Migrate Outlook tokens
  IF v_has_outlook_col THEN
    FOR r IN
      SELECT id, outlook_access_token, outlook_refresh_token, outlook_token_expires_at
        FROM users
       WHERE outlook_access_token IS NOT NULL OR outlook_refresh_token IS NOT NULL
    LOOP
      IF NOT EXISTS (SELECT 1 FROM oauth_tokens WHERE user_id = r.id AND provider = 'outlook') THEN
        PERFORM upsert_oauth_tokens(
          r.id, 'outlook',
          r.outlook_access_token,
          r.outlook_refresh_token,
          r.outlook_token_expires_at,
          NULL, NULL
        );
      END IF;
    END LOOP;
  END IF;

  -- Migrate Apple tokens
  IF v_has_apple_col THEN
    FOR r IN
      SELECT id, apple_caldav_username, apple_caldav_password
        FROM users
       WHERE apple_caldav_password IS NOT NULL
    LOOP
      IF NOT EXISTS (SELECT 1 FROM oauth_tokens WHERE user_id = r.id AND provider = 'apple') THEN
        PERFORM upsert_oauth_tokens(
          r.id, 'apple',
          NULL, NULL, NULL,
          r.apple_caldav_username,
          r.apple_caldav_password
        );
      END IF;
    END LOOP;
  END IF;
END;
$$;


-- ============================================================
-- 4. Rename old plaintext columns as backup (not dropped yet)
-- ============================================================
-- Renames to _deprecated suffix so the backend stops reading them.
-- Drop these in a follow-up migration after confirming Vault works in prod.

DO $$
BEGIN
  -- Google
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'google_access_token') THEN
    ALTER TABLE users RENAME COLUMN google_access_token TO google_access_token_deprecated;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'google_refresh_token') THEN
    ALTER TABLE users RENAME COLUMN google_refresh_token TO google_refresh_token_deprecated;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'google_token_expires_at') THEN
    ALTER TABLE users RENAME COLUMN google_token_expires_at TO google_token_expires_at_deprecated;
  END IF;

  -- Outlook
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'outlook_access_token') THEN
    ALTER TABLE users RENAME COLUMN outlook_access_token TO outlook_access_token_deprecated;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'outlook_refresh_token') THEN
    ALTER TABLE users RENAME COLUMN outlook_refresh_token TO outlook_refresh_token_deprecated;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'outlook_token_expires_at') THEN
    ALTER TABLE users RENAME COLUMN outlook_token_expires_at TO outlook_token_expires_at_deprecated;
  END IF;

  -- Apple
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'apple_caldav_username') THEN
    ALTER TABLE users RENAME COLUMN apple_caldav_username TO apple_caldav_username_deprecated;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'apple_caldav_password') THEN
    ALTER TABLE users RENAME COLUMN apple_caldav_password TO apple_caldav_password_deprecated;
  END IF;
END;
$$;

-- ============================================================
-- 5. Grant RPC access to service_role and authenticated
-- ============================================================
GRANT EXECUTE ON FUNCTION upsert_oauth_tokens TO service_role;
GRANT EXECUTE ON FUNCTION get_oauth_tokens TO service_role;
GRANT EXECUTE ON FUNCTION get_all_user_oauth_tokens TO service_role;
GRANT EXECUTE ON FUNCTION clear_oauth_tokens TO service_role;
GRANT EXECUTE ON FUNCTION users_with_oauth_provider TO service_role;

GRANT EXECUTE ON FUNCTION get_oauth_tokens TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_user_oauth_tokens TO authenticated;
