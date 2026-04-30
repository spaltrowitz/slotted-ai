# Security Audit Findings — Zuko (2026-03-06)

## Critical Findings Requiring Team Action

### 1. CRITICAL: Admin Secret Hardcoded as Default (Line 9337)
```
const ADMIN_SECRET = process.env.ADMIN_SECRET || "slotted-admin-2026";
```
If `ADMIN_SECRET` env var is not set, any attacker can access all admin endpoints with the default string. This gives full read access to ALL user data, notifications, tokens, etc.

**Decision Needed:** Remove the hardcoded fallback. Fail loudly if env var is missing (like other required vars).

### 2. CRITICAL: OAuth Tokens Stored in Plaintext (Lines 43–58, schema.sql)
Google, Apple, and Outlook OAuth tokens (access + refresh) are stored as plaintext TEXT columns in the users table. A database breach exposes calendar access for every user.

**Decision Needed:** Implement at-rest encryption for `google_refresh_token`, `google_access_token`, `apple_caldav_password`, `outlook_refresh_token`, `outlook_access_token`. This was previously flagged in the Two-Way Calendar Sync decision doc but never addressed.

### 3. HIGH: OAuth Callback Has No CSRF Protection (Lines 6744, 7432)
`GET /calendar/callback` and `GET /calendar/outlook/callback` use `state` parameter as Firebase UID. An attacker could craft a callback URL with their own `state` pointing to a victim's UID, associating the attacker's Google/Outlook account tokens with the victim's Slotted profile.

**Decision Needed:** Use a signed or random `state` token stored in a temporary table, not bare Firebase UIDs.

### 4. HIGH: Apple CalDAV Credentials Stored in Plaintext (Line 7244)
`apple_caldav_password` (app-specific password) is stored directly in the DB without encryption. Combined with the service-role key bypass, this is a high-value target.

**Decision Needed:** Encrypt at rest, same solution as #2.

---

## Medium Findings (Fix When Convenient)

### 5. In-Memory Rate Limiter Resets on Cold Start
Rate limiting uses in-memory Maps (line 69). On Firebase Functions with `maxInstances: 10`, each instance has its own counter. An attacker can bypass rate limits by distributing requests across instances, or simply waiting for a cold start.

### 6. Suggestion friendId Not Validated as Friend (Line 4372)
`GET /suggestions/:friendId` does not verify the friendId is an accepted friend. A user could query suggestion data for any arbitrary user ID.

### 7. `getDbUser` Returns `select("*")` (Line 201)
The helper fetches ALL columns including tokens. While `stripSensitive` is used at response boundaries, any internal code path that accidentally leaks the user object could expose tokens.

---

## Architecture Positives (No Action Needed)

- ✅ Firebase Auth (`requireAuth`) applied to all protected routes
- ✅ Friendship checks before accessing other users' availability (IDOR protection)
- ✅ `meetup_participants` checked before meetup mutations
- ✅ Notification writes scoped to `user_id` = current user
- ✅ Supabase parameterized queries — no SQL injection risk (PostgREST handles escaping)
- ✅ RLS enabled on all tables (blocks direct Supabase client access)
- ✅ Sensitive fields stripped from user profile responses
- ✅ CORS restricted to known origins
- ✅ Webhook secret validated on Google Calendar webhooks
- ✅ Public routes (`/health`, `/users/invite/:code`, `/meetups/shared/:code`) are properly rate-limited and return minimal data
