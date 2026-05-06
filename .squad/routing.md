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
| Visual craft, interaction patterns, Apple design review, pixel-level critique | Ty Lee | Suki |
| Product strategy, feature prioritization, MVP scoping, "should we build this?" | Toph | — |
| UX critique, user journey review, scope challenge | Toph | Suki |
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

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Toph |
| `squad:{name}` | Pick up issue and complete the work | Named member |
| `squad:copilot` | Well-defined issue routed to @copilot | @copilot |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, **Toph** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Toph's review.

## Multi-Agent Tasks

Tasks touching both frontend and backend → spawn Katara + Zuko in parallel, Toph reviews integration points.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn Sokka to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member.
8. **@copilot routing** — well-defined issues with clear specs may be routed to @copilot. Toph triages and assigns the `squad:copilot` label. See team.md Coding Agent capabilities for routing guidance (🟢/🟡/🔴).

## Notes

- **Mai (Strategist)** has been merged into **Toph (Lead)**. All product strategy, feature scoping, and MVP decisions now route directly to Toph.
- **Suki** and **Ty Lee** remain as separate Designer roles (optional). Route UI/UX design to Suki, visual craft/Apple design philosophy to Ty Lee.
