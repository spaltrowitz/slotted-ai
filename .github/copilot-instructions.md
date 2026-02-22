# Copilot Instructions — Slotted

## Project Overview

Slotted (slotted-ai) is an AI-powered app that syncs with Google Calendar to help busy young professionals maintain friendships. Built as a React + Vite PWA hosted on Firebase, with Firebase Cloud Functions (Express) as the backend and Supabase PostgreSQL as the database.

## Architecture

| Layer | Technology | Location |
|-------|-----------|----------|
| Frontend | React 19, TypeScript, Tailwind CSS v4, Vite | `client/` |
| Backend | Firebase Cloud Functions, Express, TypeScript | `functions/` |
| Database | Supabase PostgreSQL | `database/schema.sql`, `migrations/` |
| Auth | Firebase Auth (Google OAuth) | Integrated in both client and functions |
| Hosting | Firebase Hosting (SPA mode) | `build/` is the deploy output |

## Key Documentation

Before making changes, consult these docs as needed:

- **Ground truth for what exists:** `docs/06-mvp-current-state.md`
- **Product requirements:** `docs/03-prd-mvp-v1.md`
- **Future roadmap:** `docs/04-backlog-v2-v3.md`
- **Beta feedback & known issues:** `docs/11-beta-tester-feedback.md`
- **UX audit:** `docs/10-ux-audit-checklist.md`
- **Active plans:** `docs/plans/` (per-feature research and implementation plans)

## Development Workflow (Research → Plan → Annotate → Implement)

Follow this phased approach for all non-trivial work. **Never jump straight to code.**

### Phase 1: Research

When asked to research or understand a part of the codebase:

- Read broadly and deeply — files, schemas, API routes, component trees
- Write findings into a persistent markdown file: `docs/plans/research-<feature>.md`
- Include: what exists, how it works, edge cases, potential issues, relevant schema/types
- Do NOT propose solutions yet — just document understanding

### Phase 2: Plan

When asked to write a plan:

- Create `docs/plans/plan-<feature>.md`
- Include: approach summary, file-by-file changes with code snippets, schema changes, trade-offs
- Add a granular todo list at the bottom with phases and individual tasks
- Base the plan on actual code (read files first), not assumptions
- Do NOT implement until explicitly told to

### Phase 3: Annotate (User-Driven)

The user will add inline notes to the plan file (prefixed with `> **NOTE:**` or similar). When told "I added notes to the plan":

- Re-read the plan file
- Address every note — update the plan accordingly
- Do NOT implement yet unless explicitly told
- Ask for clarification only if a note is genuinely ambiguous

### Phase 4: Implement

When told to implement:

- Follow the plan file exactly
- Mark tasks complete in the plan as you go (change `[ ]` → `[x]`)
- Don't stop until all tasks are done
- Run type checks after changes: `cd client && npx tsc --noEmit`
- Run `cd functions && npm run build` after backend changes
- Match existing code patterns in the codebase (see conventions below)

## Code Conventions

### Frontend (`client/`)

- **Components:** Functional React components with TypeScript, in `client/src/components/`
- **Pages:** One file per page in `client/src/pages/`, named `<Name>Page.tsx`
- **Styling:** Tailwind CSS v4 with the project's custom `slotted` design tokens — use existing utility classes, don't introduce new CSS files
- **State:** React Context in `client/src/contexts/` for global state (e.g., `AuthContext`)
- **API calls:** Centralized in `client/src/lib/api.ts` — add new endpoints there, don't scatter fetch calls in components
- **Routing:** React Router, protected routes use `ProtectedRoute` component
- **No unnecessary comments or JSDoc** — code should be self-documenting
- **No `any` or `unknown` types** — use proper TypeScript types

### Backend (`functions/`)

- **Express routes** in `functions/src/index.ts`
- **Supabase client** in `functions/src/supabase.ts`
- **Auth middleware:** Firebase Auth token verification on all protected endpoints
- **Database:** Direct Supabase queries (no ORM). Migrations go in `migrations/` as SQL files

### Database

- **Schema:** `database/schema.sql` is the canonical schema
- **Migrations:** Individual SQL files in `migrations/`, named descriptively
- **RLS:** Row-Level Security is enabled — account for it in queries
- **Naming:** snake_case for tables and columns

## Product Design Principles

These are core to Slotted's identity — always respect them:

1. **Privacy-first:** Never expose calendar details, social battery status, or friend activity to other users. The AI uses this data internally but it's never displayed.
2. **Soft social dynamics:** Avoid language like "decline" or "rejected." Use "not this time," "maybe." No ❌ icons for social actions.
3. **AI is invisible infrastructure:** The AI suggests and ranks, but users feel like they're making their own choices. No "AI recommended this" badges.
4. **Reduce friction at moments of excitement:** When a friend accepts, auto-add to calendar. Don't make users click through steps at their happiest moment.
5. **No social pressure:** Don't show connection status, free slot counts, or anything that pressures users to act.

## Common Tasks — Quick Reference

| Task | How |
|------|-----|
| Run frontend dev server | `cd client && npm run dev` |
| Type-check frontend | `cd client && npx tsc --noEmit` |
| Build functions | `cd functions && npm run build` |
| Deploy functions | `firebase deploy --only functions` |
| Deploy hosting | `cd client && npm run build && cd .. && firebase deploy --only hosting` |
| Run everything locally | Firebase emulators: `firebase emulators:start` |
| Add a migration | Create a new `.sql` file in `migrations/` |

## When Unsure

- Check `docs/06-mvp-current-state.md` for what's actually built vs. what was planned
- Check `docs/11-beta-tester-feedback.md` for known issues and user pain points
- Look at existing similar code before creating new patterns
- If a feature plan exists in `docs/plans/`, follow it rather than improvising
