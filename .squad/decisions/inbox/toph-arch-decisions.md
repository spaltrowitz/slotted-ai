# Architecture Decisions: Security Audit Follow-Up

**Author:** Toph (Lead/Architect)  
**Date:** 2026-05-01  
**Status:** Ready for implementation  
**Assignee:** Zuko (Backend)

---

## Decision 1 — RLS Policy Strategy

### Recommendation: Option A — Add defensive RLS policies now

### Rationale

The service role key is a single point of failure. If it leaks (env var exposure, logging accident, compromised Firebase Function), the attacker gets full read/write to all 18 tables with zero row-level restrictions. RLS policies cost nothing at runtime when using the service role (bypassed entirely), but they **activate immediately** if anyone connects with `anon` or `authenticated` roles — which could happen via a Supabase client misconfiguration, a future feature using client-side Supabase, or direct PostgREST access. This is pure defense-in-depth with zero performance cost.

### Implementation Spec

**File:** `database/migrations/add_rls_policies.sql`

Create policies for all 18 tables following this pattern:

```sql
-- Users: can only read/update own row
CREATE POLICY users_select_own ON users FOR SELECT
  USING (auth.uid()::text = firebase_uid);
CREATE POLICY users_update_own ON users FOR UPDATE
  USING (auth.uid()::text = firebase_uid);

-- Friendships: can see friendships you're part of
CREATE POLICY friendships_select ON friendships FOR SELECT
  USING (
    user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()::text)
    OR friend_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()::text)
  );

-- Meetups: can see meetups you participate in
CREATE POLICY meetups_select ON meetups FOR SELECT
  USING (
    id IN (SELECT meetup_id FROM meetup_participants WHERE user_id IN
      (SELECT id FROM users WHERE firebase_uid = auth.uid()::text))
  );

-- Meetup participants: can see/update your own participation
CREATE POLICY mp_select ON meetup_participants FOR SELECT
  USING (user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()::text));
CREATE POLICY mp_update ON meetup_participants FOR UPDATE
  USING (user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()::text));

-- Notifications: own only
CREATE POLICY notif_select ON notifications FOR SELECT
  USING (user_id IN (SELECT id FROM users WHERE firebase_uid = auth.uid()::text));

-- Pattern: user-scoped tables (fcm_tokens, availability, suggestion_events,
--   feedback, meetup_logs, user_preferences, user_calendars, activity_dismissals,
--   manual_busy_blocks) all use: user_id = current_user_id()
```

**Key rules:**
- Every table gets at minimum a SELECT policy scoped to the owning user
- INSERT policies only where user-initiated creation makes sense (meetups, feedback)
- DELETE policies restrictive — only own data
- No UPDATE policies on `created_by` or `id` columns
- Create a helper function `current_user_internal_id()` that maps `auth.uid()` → `users.id` to DRY the subqueries

**Testing:** After deploying, verify service-role queries still work unchanged. Test with anon key to confirm policies block cross-user access.

### Risks
- Policies reference `auth.uid()` which maps to Supabase Auth, not Firebase Auth. Since we use Firebase Auth → service role, these policies only activate in a non-service-role scenario. That's fine — they're the safety net for exactly that case.
- If we ever add Supabase Auth or client-side Supabase SDK, the `firebase_uid` mapping needs rethinking.

---

## Decision 2 — Token Encryption Strategy

### Recommendation: Option D (hybrid) — Move tokens to `oauth_tokens` table + Supabase Vault (pgsodium)

### Rationale

Supabase Vault is the simplest option that actually works in this stack. It's built into Supabase, requires no external KMS, no key management in Firebase Functions, and encrypts at the column level using `pgsodium`. Moving tokens to a separate table isolates the sensitive surface area (smaller blast radius for a targeted table dump) and makes it easy to apply different access policies. App-layer encryption (Option B) would require managing encryption keys in Firebase Functions environment — feasible but adds operational complexity for key rotation. Vault handles rotation natively.

### Implementation Spec

**Phase 1 — New table + migration:**

**File:** `database/migrations/create_oauth_tokens.sql`

```sql
-- Depends on: vault extension enabled in Supabase dashboard
CREATE TABLE oauth_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL CHECK (provider IN ('google', 'outlook', 'apple')),
  
  -- Encrypted via Supabase Vault (pgsodium transparent column encryption)
  access_token    TEXT,
  refresh_token   TEXT,
  token_expires_at TIMESTAMPTZ,
  
  -- Apple CalDAV specific
  caldav_username TEXT,
  caldav_password TEXT,
  
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE (user_id, provider)
);

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Encrypt sensitive columns using vault
SELECT vault.create_secret('oauth_tokens_access_token_key', 'pgsodium');
SECURITY LABEL FOR pgsodium ON COLUMN oauth_tokens.access_token IS 'ENCRYPT WITH KEY ID oauth_tokens_access_token_key';
SECURITY LABEL FOR pgsodium ON COLUMN oauth_tokens.refresh_token IS 'ENCRYPT WITH KEY ID oauth_tokens_access_token_key';
SECURITY LABEL FOR pgsodium ON COLUMN oauth_tokens.caldav_password IS 'ENCRYPT WITH KEY ID oauth_tokens_access_token_key';
```

**Phase 2 — Data migration:**

**File:** `database/migrations/migrate_tokens_to_vault.sql`

```sql
-- Copy existing tokens to new table
INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, token_expires_at)
SELECT id, 'google', google_access_token, google_refresh_token, google_token_expires_at
FROM users WHERE google_access_token IS NOT NULL;

INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, token_expires_at)
SELECT id, 'outlook', outlook_access_token, outlook_refresh_token, outlook_token_expires_at
FROM users WHERE outlook_access_token IS NOT NULL;

INSERT INTO oauth_tokens (user_id, provider, caldav_username, caldav_password)
SELECT id, 'apple', apple_caldav_username, apple_caldav_password
FROM users WHERE apple_caldav_username IS NOT NULL;

-- Drop old columns (run AFTER verifying migration)
-- ALTER TABLE users DROP COLUMN google_access_token, ...
```

**Phase 3 — Backend changes:**

**File:** `functions/src/index.ts` — everywhere that reads/writes OAuth tokens:
- Replace `users.google_access_token` reads with `SELECT access_token FROM oauth_tokens WHERE user_id = $1 AND provider = 'google'`
- Replace token writes (OAuth callback, token refresh) to INSERT/UPDATE `oauth_tokens`
- Search for: `google_access_token`, `google_refresh_token`, `outlook_access_token`, `outlook_refresh_token`, `apple_caldav_password`

### Risks
- Supabase Vault (pgsodium) must be enabled in the Supabase dashboard first. Check project settings → Extensions.
- Vault's transparent encryption means the service role still sees plaintext in query results — protection is against raw disk/backup exposure, not a compromised service role. For service-role compromise, RLS policies (Decision 1) are the complementary control.
- Token reads add one JOIN. Negligible perf impact.

---

## Decision 3 — Meetup Race Condition

### Recommendation: Option A — Database trigger

### Rationale

A Postgres trigger is the most robust solution because it executes atomically within the same transaction as the RSVP update — there's no window where two concurrent updates can both see stale state. It's also the simplest to maintain: the logic lives in one place (the database), requires no application-code coordination, and works regardless of which code path updates the participant row. Serializable isolation (Option B) adds retry complexity and potential deadlocks. Optimistic locking (Option C) pushes race handling to application code across potentially multiple endpoints.

### Implementation Spec

**File:** `database/migrations/add_meetup_auto_confirm_trigger.sql`

```sql
CREATE OR REPLACE FUNCTION check_meetup_all_accepted()
RETURNS TRIGGER AS $$
DECLARE
  total_count INT;
  accepted_count INT;
  meetup_status TEXT;
BEGIN
  -- Only fire when rsvp changes to 'accepted'
  IF NEW.rsvp != 'accepted' OR (OLD.rsvp = 'accepted') THEN
    RETURN NEW;
  END IF;

  -- Get current meetup status (skip if already confirmed/cancelled)
  SELECT status INTO meetup_status FROM meetups WHERE id = NEW.meetup_id FOR UPDATE;
  IF meetup_status != 'proposed' THEN
    RETURN NEW;
  END IF;

  -- Count participants
  SELECT COUNT(*) INTO total_count
  FROM meetup_participants WHERE meetup_id = NEW.meetup_id;

  SELECT COUNT(*) INTO accepted_count
  FROM meetup_participants WHERE meetup_id = NEW.meetup_id AND rsvp = 'accepted';

  -- +1 because NEW row hasn't been committed yet in BEFORE trigger
  -- (Use AFTER trigger instead to avoid this)
  IF accepted_count = total_count THEN
    UPDATE meetups SET status = 'confirmed' WHERE id = NEW.meetup_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_meetup_check_all_accepted
  AFTER UPDATE OF rsvp ON meetup_participants
  FOR EACH ROW
  EXECUTE FUNCTION check_meetup_all_accepted();
```

**Key details:**
- Uses AFTER UPDATE trigger so `NEW` row is already visible in the count
- `FOR UPDATE` lock on the meetups row serializes concurrent checks — two triggers firing simultaneously will serialize on this lock, ensuring exactly one sees the final count
- Only fires on `rsvp` column changes (efficient)
- Guards against double-firing: skips if meetup already confirmed
- The existing application code that checks "all accepted" in `index.ts` should be **kept as a fallback** log/no-op (belt and suspenders), but the trigger is now the authoritative state transition

**Backend change (minimal):**

**File:** `functions/src/index.ts` — find the RSVP acceptance handler:
- Remove the "check all accepted and update meetup status" logic OR convert it to a read-only assertion/log
- The trigger handles it atomically now
- Keep the notification-sending logic in the application code (trigger shouldn't send HTTP requests)

**Notification flow:**
After the RSVP update returns, re-read the meetup status. If it's now `confirmed`, fire the "meetup confirmed" notifications. This is safe because the trigger already ran within the same transaction.

### Risks
- Trigger runs inside the transaction — if it errors, the RSVP update rolls back. Keep the trigger logic simple and defensive.
- Notification sending must remain in application code (Firebase Functions), not in the trigger. The trigger only transitions state.
- If we add new RSVP states (e.g., 'tentative'), the trigger condition needs updating.

---

## Summary

| # | Decision | Effort | Priority |
|---|----------|--------|----------|
| 1 | Defensive RLS policies | 1-2 days | High (defense-in-depth) |
| 2 | OAuth tokens → Vault-encrypted table | 2-3 days | Critical (data protection) |
| 3 | Database trigger for auto-confirm | 0.5 day | Medium (correctness) |

**Implementation order:** 3 → 1 → 2 (quick win first, then defense-in-depth, then the larger migration)

Zuko: start with Decision 3 (trigger), it's a single migration file. Then tackle 1 and 2 in sequence.
