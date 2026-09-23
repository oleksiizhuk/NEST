# AI tooling for NEST

Repo-wide rules for Claude are in the root `CLAUDE.md`. Skills (instruction sets the main conversation follows) live in `.claude/skills/`, subagents in `.claude/agents/`, long-form guides in `.claude/references/`, project settings and hooks in `.claude/settings.json`.

## Typical flow

```
idea / task
  → implementation-planner   plan by Clean Architecture layer    [user review]
  → new-feature              implement domain → app → infra → specs
  → quality-gates            tsc, lint, test:cov, build
  → review                   bugs + architecture, --fix for confirmed ones
  → commit → pr              diff shown before commit, PR via gh
  → deploy                   merge to master, watch Vercel, smoke prod
```

## Skills

| Skill | Purpose |
| --- | --- |
| `implementation-planner` | Plan a feature across domain / application / infrastructure before coding |
| `new-feature` | Implement an endpoint through every layer, the way `product` is built |
| `quality-gates` | Types, lint, tests with coverage, build — per-gate report |
| `review` | Parallel review angles + verification, ranked findings; `--fix` |
| `commit` | Conventional Commits with a scope; diff approved before committing |
| `pr` | Branch, push, `gh pr create` |
| `deploy` | Vercel production: merge, build status, smoke, env vars |
| `onboard` | Fresh clone → running dev server and Swagger |

## Agents

| Agent | Role | Used by |
| --- | --- | --- |
| `code-reviewer` | One review angle, a verification pass, or a quick full review | `review`, the main conversation |
| `codebase-researcher` | Answers one "where / how does X" question with `file:line` citations | the main conversation |

## Settings

- A `PostToolUse` hook runs Prettier on every `.ts` file Claude writes or edits.
- Read-only git and the test/lint/build commands are pre-allowed; reading `.env` files is denied.
- Personal overrides go in `.claude/settings.local.json` (not committed).
