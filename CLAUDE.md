# Claude Code Instructions

## Workflow: Research → Plan → Implement

Never jump straight to code. Follow this pipeline for any non-trivial task:

### 1. Research Phase
- Read the relevant parts of the codebase **deeply** before proposing anything.
- Write findings to `research.md` in the working directory — never just a verbal summary.
- Understand existing patterns, caching layers, ORM conventions, and shared utilities before suggesting changes.
- Surface-level reading is not acceptable. Read implementations, not just signatures.

### 2. Planning Phase
- Write a detailed `plan.md` with: approach explanation, code snippets showing actual changes, file paths to modify, and trade-offs.
- **Do not implement until the plan is explicitly approved.** Wait for "implement it" or equivalent.
- When I add inline notes to the plan, address every note and update the document. Do not start implementing.
- Include a granular todo list with phases and individual tasks at the end of the plan.

### 3. Implementation Phase
- When told to implement: execute the entire plan, mark tasks complete in `plan.md` as you go.
- Do not stop for confirmation mid-flow. Complete all tasks and phases.
- Continuously run typecheck/lint to catch issues early, not at the end.
- Do not add unnecessary comments or jsdocs.
- Do not use `any` or `unknown` types unless absolutely unavoidable.

## Code Principles

- **Follow existing patterns.** Study how the codebase does things before introducing new approaches. Reference existing implementations rather than designing from scratch.
- **DRY first.** Search for existing utilities, helpers, and patterns before writing new ones.
- **No over-engineering.** Pick the simpler option when two approaches work. Do not add caching, retries, or abstractions unless explicitly requested.
- **Preserve interfaces.** Do not change public API signatures, function contracts, or database schemas without explicit approval.
- **Tight error handling.** No broad try/catch blocks. No silent failures. Propagate errors explicitly.
- **Type safety.** Changes must pass build and type-check. Prefer proper types and guards over casts.

## Communication Style

- Be concise and direct. Lead with outcomes, not explanations.
- During research/planning: be thorough and detailed in written artifacts.
- During implementation: terse status updates. I will give terse corrections — a single sentence is enough context for you.
- Do not ask clarifying questions unless genuinely blocked. Make reasonable assumptions and move forward.
- When I reference existing code ("make it look like X"), read that reference thoroughly before making changes.

## Git & File Safety

- Never revert changes you did not make.
- Never use `git reset --hard` or `git checkout --` unless I explicitly ask.
- Do not amend commits unless asked.
- If you notice unexpected changes in the worktree, stop and ask.

## Iteration & Corrections

- When I say something is wrong, do not try to patch it incrementally. If the approach is fundamentally wrong, expect me to revert and re-scope.
- For frontend work: expect rapid terse corrections ("wider", "still cropped", "2px gap"). Act on them immediately.
- When I share screenshots, use them as the primary source of truth for visual issues.
