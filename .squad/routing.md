# Routing Rules

## Domain Routing

| Domain / Keywords | Primary Agent | Backup |
|-------------------|---------------|--------|
| Architecture, design decisions, scope, trade-offs | Toph | — |
| React, components, pages, UI, Tailwind, styling, PWA | Katara | Toph |
| Firebase Functions, Express, API routes, Supabase queries, database, migrations | Zuko | Toph |
| Tests, testing, quality, edge cases, validation | Sokka | Zuko |
| Google Calendar, calendar sync, OAuth tokens | Zuko | Toph |
| AI features, suggestions, ranking, prompts | Toph + Zuko | — |
| UI/UX design, visual design, layout, design tokens, accessibility | Suki | Katara |
| Product strategy, feature prioritization, MVP scoping, "should we build this?" | Mai | Toph |
| UX critique, user journey review, scope challenge | Mai | Suki |
| Performance, bundle size, loading | Katara (frontend) / Zuko (backend) | Toph |
| Auth, Firebase Auth, tokens, middleware | Zuko | Toph |
| Schema changes, RLS policies, migrations | Zuko | Toph |

## Review Gates

| Artifact | Reviewer | Gate |
|----------|----------|------|
| Architecture decisions | Toph | Must approve before implementation |
| API contracts | Toph | Must approve before frontend integration |
| New components / pages | Sokka | Must have test coverage |
| Database migrations | Toph + Zuko | Both must approve |

## Multi-Agent Tasks

Tasks touching both frontend and backend → spawn Katara + Zuko in parallel, Toph reviews integration points.
