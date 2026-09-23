---
name: onboard
description: Take a fresh clone of this NestJS API to a running dev server — Node version, install, .env from .env.example, Mongo connection, first start and Swagger. Use for "онбординг", "настрой проект", "как запустить", "set me up". Not for the gates (quality-gates) or deploys (deploy).
allowed-tools: Bash, Read, Grep, Glob
---

# Onboarding

## Steps

1. **Toolchain.** `node -v` against `.nvmrc` (Node 24; `engines` says `24.x`), `npm -v`, `git --version`. Report a mismatch with `nvm use`; install nothing system-wide.
2. **Install.** `npm install`. It runs `prepare` → husky; confirm `git config core.hooksPath` points at `.husky/_`, otherwise the pre-commit lint and pre-push tests silently do nothing.
3. **Env.** If `.env` is missing, `cp .env.example .env`. If it exists, compare **key names only**: `grep -oE '^[A-Z_]+=' .env | sort` against the same for `.env.example`. Never print a value.
   - Blocking: `MONGODB_URI` (the app no longer has a fallback; it is not in `.env.example` yet — the person needs their own Atlas URI or a local `mongodb://localhost:27017/nest`) and `JWT_SECRET`.
   - Optional, feature-scoped: `MAIL_*` (email), `TELEGRAM_*` + `JIRA_*` (Telegram bot), `ANTHROPIC_KEY` + `MCP_*` (the `/mcp` bridge), `B_API_*` (Binance).
4. **Sanity.** `npx tsc --noEmit` and `npm test`. Report failures, fix nothing here.
5. **Run.** `npm run start:dev` in the background, poll until the port answers, then `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/docs` (expect 200). Report the port and the Swagger URL.
6. **Hand off.** Point at `CLAUDE.md` for architecture, `.claude/README.md` for skills, `quality-gates` before a PR, `deploy` for production.

## Never

- Print, log or repeat a value from `.env` or any token the person pastes.
- Copy credentials from Vercel, another project or a previous session into their `.env`.
- Commit anything during onboarding.

## Reporting

A step → done/blocked table, then each blocker with the exact command that fixes it.
