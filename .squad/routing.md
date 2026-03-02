# Routing Rules

## Domain Routing

| Domain / Keywords | Primary Agent | Backup |
|-------------------|---------------|--------|
| Architecture, design decisions, scope, trade-offs | Leo | — |
| React, components, pages, UI, Tailwind, styling, PWA | CJ | Leo |
| Firebase Functions, Express, API routes, Supabase queries, database, migrations | Sam | Leo |
| Tests, testing, quality, edge cases, validation | Josh | Sam |
| Google Calendar, calendar sync, OAuth tokens | Sam | Leo |
| AI features, suggestions, ranking, prompts | Leo + Sam | — |
| Performance, bundle size, loading | CJ (frontend) / Sam (backend) | Leo |
| Auth, Firebase Auth, tokens, middleware | Sam | Leo |
| Schema changes, RLS policies, migrations | Sam | Leo |

## Review Gates

| Artifact | Reviewer | Gate |
|----------|----------|------|
| Architecture decisions | Leo | Must approve before implementation |
| API contracts | Leo | Must approve before frontend integration |
| New components / pages | Josh | Must have test coverage |
| Database migrations | Leo + Sam | Both must approve |

## Multi-Agent Tasks

Tasks touching both frontend and backend → spawn CJ + Sam in parallel, Leo reviews integration points.
