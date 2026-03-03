# Deploy Status: Firebase Functions (Zuko, 2026-03-03)

| Field | Value |
|---|---|
| **Author** | Zuko (Backend Dev) |
| **Date** | 2026-03-03 |
| **Status** | Blocked |
| **Scope** | Production deployment of Firebase Functions |

## Summary

Firebase Functions deploy **failed** with two blockers:

### 1. Placeholder credentials in `functions/.env`

Three env vars still contain `PASTE_YOUR_*` placeholder text:
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

**Action needed:** Shari must replace these with real values from Supabase dashboard and Google Cloud Console.

### 2. Deploy timeout (10s) during code analysis

Firebase CLI 15.8.0 timed out loading user code. Contributing factors:
- All env vars reported missing — `.env` may not be loaded during deploy analysis
- `package.json` specifies Node.js 24 engine — may not be supported by Firebase yet
- `firebase-functions` v7 flagged as outdated by CLI

**Action needed:** Verify Firebase supports Node.js 24 for Cloud Functions. Consider downgrading to Node 22 if not. After fixing env vars, re-attempt deploy.

### Migration SQL

The constraint DROP (statement 5) was already run. Statements 1–4 (column additions) need verification against live schema. Shari has the check query.
