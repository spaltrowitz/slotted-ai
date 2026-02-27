# Routing Rules

## Domain Routing

| Domain / Keywords | Primary Agent | Backup |
|-------------------|---------------|--------|
| Architecture, design decisions, scope, trade-offs | Beard | — |
| React, components, pages, UI, Tailwind, styling, PWA | Keeley | Beard |
| Firebase Functions, Express, API routes, Supabase queries, database, migrations | Roy | Beard |
| Tests, testing, quality, edge cases, validation | Nate | Roy |
| Google Calendar, calendar sync, OAuth tokens | Roy | Beard |
| AI features, suggestions, ranking, prompts | Beard + Roy | — |
| Performance, bundle size, loading | Keeley (frontend) / Roy (backend) | Beard |
| Auth, Firebase Auth, tokens, middleware | Roy | Beard |
| Schema changes, RLS policies, migrations | Roy | Beard |

## Review Gates

| Artifact | Reviewer | Gate |
|----------|----------|------|
| Architecture decisions | Beard | Must approve before implementation |
| API contracts | Beard | Must approve before frontend integration |
| New components / pages | Nate | Must have test coverage |
| Database migrations | Beard + Roy | Both must approve |

## Multi-Agent Tasks

Tasks touching both frontend and backend → spawn Keeley + Roy in parallel, Beard reviews integration points.
