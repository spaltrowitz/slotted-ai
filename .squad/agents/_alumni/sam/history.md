# Sam — History

## Project Context
- **Project:** Slotted — AI-powered friendship maintenance app syncing with Google Calendar
- **Owner:** Shari Paltrowitz
- **Stack:** Firebase Functions + Express + TS (functions/), Supabase PostgreSQL (database/schema.sql), Firebase Auth
- **Backend structure:** routes in functions/src/index.ts, Supabase client in functions/src/supabase.ts, migrations in migrations/

## Learnings

<!-- Append learnings below -->

### CORS Configuration (QW-4 fix)
- **Location:** `functions/src/index.ts` lines 42–60
- **Allowed origins:** `localhost:5173`, `localhost:5174` (dev), `slotted-ai.web.app`, `slotted-ai.firebaseapp.com` (prod)
- **Pattern:** The `cors` package's `origin` callback takes `(Error | null, boolean)`. Use `callback(new Error("Not allowed by CORS"))` to reject unknown origins — this is the standard rejection pattern from the cors docs.
- **No-origin requests** (mobile apps, curl, server-to-server) are allowed through via `!origin` check — this is intentional and standard.
- **Security note:** The original code had `callback(null, true)` in the else branch, meaning ANY domain could make authenticated cross-origin requests. This was a security hole.
