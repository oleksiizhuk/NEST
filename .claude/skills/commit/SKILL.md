---
name: commit
description: Create a git commit in this repo's Conventional Commits format (feat(scope): ...) after showing the user the diff and getting approval. Use when the user asks to commit ("закоммить", "commit this"). For "commit and open a PR", do this first, then the pr skill.
---

# Commit changes

## Steps

1. **Preflight.** If HEAD is detached or a merge/rebase is in progress, stop and ask. If on `master`, create a branch first (`feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `refactor/<slug>`) — a push to `master` deploys production on Vercel (see the `deploy` skill).
2. **Read the change.** `git status --short` and `git diff HEAD`. `git diff HEAD` hides untracked files — read new files listed by `git status` separately. Nothing to commit → say so and stop.
3. **Separate the user's other work.** The tree often holds unrelated uncommitted changes. Commit only what the user asked for; if one file mixes both, stage only the relevant hunks (`git diff <file> > <scratchpad>/p.patch`, trim it, `git apply --cached`) or ask which to include. Check `git diff --cached --name-only` for anything already staged that the user did not ask for.
4. **Show the diff and wait.** Print the list of files and the diff (or a faithful summary when it is long) and wait for explicit approval. Never commit without it.
5. **Message.** Conventional Commits, as in `git log`:
   - Subject `<type>(<scope>): <imperative summary>`, English, no trailing period, ≤ 72 chars. Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`. Scope is the area: `mcp`, `auth`, `user`, `product`, `cart`, `telegram`, `email`, `config`, `ci`, `vercel`.
   - Body: why the change was made, in prose; what is visible in the diff does not need repeating.
   - Then a blank line and the attribution trailer the session supplies (`Co-Authored-By: ...`), once.
6. **Hooks.** Husky `pre-commit` runs `npm run lint` (with `--fix`, so it may rewrite files — re-check `git status` after a failed attempt). `pre-push` runs lint and `npm run test:cov`. For nontrivial code run the `quality-gates` skill before committing. Never `--no-verify` unless the user asks.
7. Stage explicit paths (`git add <paths>`) and commit with a heredoc message.

## Never

- `git add .` / `git add -A` — `.env*` files and `scripts/` experiments live in the tree.
- Amend or force-push a pushed commit without explicit confirmation.
- Push unless the user asked for it in this request.
