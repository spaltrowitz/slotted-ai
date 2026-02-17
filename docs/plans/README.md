# Plans Directory

Per-feature research and implementation plans. Working documents — not permanent reference docs.

## Naming Convention

- `research-<feature>.md` — Deep-read findings before planning
- `plan-<feature>.md` — Implementation plan with code snippets and todo list

## Workflow

1. Ask Copilot to research → produces `research-<feature>.md`
2. Ask Copilot to plan → produces `plan-<feature>.md`
3. Add inline notes to the plan → ask Copilot to address them (repeat 1-6x)
4. Say "implement" → Copilot follows the plan, marking tasks complete

## Example Prompts

**Research:**
> Read the notification system in depth — understand how it sends, deduplicates, and delivers push notifications. Write findings in `docs/plans/research-notifications.md`.

**Plan:**
> Based on the research, write a plan to add notification batching (group multiple notifications into a digest). Write it in `docs/plans/plan-notification-batching.md`. Include code snippets. Don't implement yet.

**Annotate:**
> I added notes to `docs/plans/plan-notification-batching.md`. Address all my notes and update the document. Don't implement yet.

**Implement:**
> Implement the plan in `docs/plans/plan-notification-batching.md`. Mark tasks complete as you go. Don't stop until done. Run type checks after changes.
