# Skill: Supabase Vault Encryption

## When to Use
When storing sensitive credentials (OAuth tokens, API keys, passwords) in a Supabase PostgreSQL database that need encryption at rest.

## Pattern

### Architecture
- Store sensitive values in `vault.secrets` via `vault.create_secret(json_text, name, description)`
- Create a mapping table with `secret_id UUID` column pointing to `vault.secrets(id)`
- Read decrypted values via `vault.decrypted_secrets` view (auto-decrypts)
- Wrap operations in SECURITY DEFINER functions callable via RPC

### Key API
```sql
-- Store: returns UUID
SELECT vault.create_secret('{"key": "value"}', 'unique_name', 'description');

-- Update in-place
SELECT vault.update_secret(secret_uuid, 'new_value', 'name', 'description');

-- Read decrypted
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = secret_uuid;

-- Delete
DELETE FROM vault.secrets WHERE id = secret_uuid;
```

### Backend Integration (TypeScript + Supabase client)
```typescript
// Write via RPC (calls SECURITY DEFINER function)
await supabase.rpc("upsert_oauth_tokens", { p_user_id: id, p_provider: "google", ... });

// Read via RPC
const { data } = await supabase.rpc("get_oauth_tokens", { p_user_id: id, p_provider: "google" });
```

## Important Notes
- Supabase is **deprecating pgsodium TCE** (SECURITY LABEL approach). Use Vault secret store directly.
- `service_role` key bypasses RLS — can access vault functions directly
- Store multiple fields as JSON in one vault secret to reduce secret count
- Name secrets with a pattern (e.g., `oauth:{user_id}:{provider}`) for discoverability
- The `vault.decrypted_secrets` view is only accessible to roles with explicit GRANT
