---
name: deploy
description: Ship to production on Vercel and confirm it is healthy — merge to master, watch the build, smoke the live API and /mcp, manage env vars. Use for "задеплой", "выкати", "проверь прод", "add an env var to Vercel". Not for creating the PR itself (pr).
---

# Deploy

Production is the Vercel project `nest` (GitHub integration). **Every push or merge to `master` deploys production**; other branches get preview deploys. The Vercel CLI is used through `npx vercel` (no global install); the project is linked locally in `.vercel/` (gitignored).

## Ship

1. Work lands through a PR (the `pr` skill). Merge only when the user asked: `gh pr merge <n> --merge --delete-branch`.
2. `git push` without a credential helper fails with "could not read Username" — push with `git -c credential.helper='!gh auth git-credential' push`.
3. Watch the build: `npx vercel ls nest` until the newest production deployment is `● Ready` (or `● Error` → `npx vercel inspect <url> --logs`).

## Smoke

- API: `curl -s -o /dev/null -w '%{http_code}' https://nest-ruby-theta.vercel.app/api/docs` → 200.
- `/mcp` without a token → 401, `GET /mcp` → 405. A real `ask_advice` call needs `MCP_TOKEN` and spends Anthropic credits — ask before making one.
- Runtime logs: `npx vercel logs <deployment-url>` (Hobby keeps about an hour).

## Env vars

- List names: `npx vercel env ls`. Add: `npx vercel env add NAME production < file` (value from a file or stdin, never on the command line). A new value needs a redeploy to take effect.
- Never `vercel env pull` into the repo or print a secret; sensitive values come back masked anyway.
- New variables also go into `.env.example` and the env table in `CLAUDE.md`.

## Limits worth knowing

- Functions run up to 300 s (`vercel.json` → `maxDuration`, Fluid Compute on). Long Claude answers on `/mcp` must finish inside that.
- `vercel.json` rewrites every path to `api/index.js`, which serves the compiled `dist/`.
