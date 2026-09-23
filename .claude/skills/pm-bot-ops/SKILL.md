---
name: pm-bot-ops
description: Operate the Telegram project-manager bot day to day — health checks of its sources and test environments, chat controls, the daily digest, config changes through Vercel env, rotating its secrets. Use for "проверь бота", "обнови снимок", "почему бот не видит Jira/Figma", "health of the PM bot", "switch the bot on in a group", "rotate the Figma token". Not for a silent or failing bot (pm-bot-debug), changing its code (new-feature, pm-bot-add-action) or shipping it (deploy).
---

# PM bot ops

In chats listed in `TELEGRAM_PM_CHAT_IDS` (or switched on with `/pm_on`) the Telegram bot answers as a delivery manager: it reads Jira, Confluence, GitHub and Figma into a `ProjectSnapshot` in Mongo, answers from that snapshot plus `PM_PROJECT_BRIEF`, can read code in allowlisted repos, and proposes brand actions (create, publish, unpublish, delete) on the dev/staging admin API that a human must confirm. Every other chat keeps the persona and never sees project data. Instructions in the repo are generic; **everything project-specific (client, hosts, accounts, chat ids) lives in Vercel env and in Claude's local memory — never write it into the repo, a commit or a PR.**

Where it lives:
- Application: `src/application/project-manager/` (use cases, `tools/pm-toolbox.ts`, `pm.config.interface.ts`); chat commands in `src/application/telegram/use-cases/handle-telegram-message.use-case.ts`.
- Infrastructure: `src/infrastructure/project-manager/` (sources, `pm.config.ts`), `src/infrastructure/staging-admin/http-staging-admin.ts`, HTTP in `src/infrastructure/http/project-manager/` (`pm-cron.controller.ts`, `pm-knowledge.controller.ts`, `cron-secret.guard.ts`).
- Schedule: `vercel.json` → `crons`. Mongo collections: `pmchats`, `pmactions`, `pmknowledges`, the snapshot.

## Admin page

The owner opens it by sending `/admin` to the bot in a private chat: the bot replies with a one-time link (10 minutes) to `https://<host>/admin/`. Limits, access lists, alert recipients and chat effort changed there apply within 30 s without a redeploy and override the Vercel env; an emptied field goes back to the env value. Nobody else can log in: links are issued only to `TELEGRAM_OWNER_ID`, and sessions are checked against it.

Password login (optional): `PM_ADMIN_EMAIL` + `PM_ADMIN_PASSWORD_HASH` (bcrypt), then the bot asks the owner "Это вы?" in Telegram; the page opens only after "Да, это я" (2 minutes). A "Нет" locks password login for 15 minutes. To change the password, take it from a hidden dialog, hash it and replace the variable, then redeploy — the password is never printed or stored:

```bash
PMPW="$(osascript -e 'text returned of (display dialog "New admin password" default answer "" with hidden answer)')" \
  node -e "process.stdout.write(require('bcryptjs').hashSync(process.env.PMPW, 12))" > /tmp/h && \
  npx vercel env rm PM_ADMIN_PASSWORD_HASH production -y && npx vercel env add PM_ADMIN_PASSWORD_HASH production < /tmp/h; rm -f /tmp/h
```

Then press "Выйти везде" in the admin page to end old sessions.

## Health checks

All `/cron/pm/*` routes need `Authorization: Bearer $CRON_SECRET` (the guard compares in constant time; unset secret = always 401). The secret is only in Vercel env — read it into a shell variable without echoing, never print it, never paste it into chat:

```bash
# the user pastes CRON_SECRET into a hidden dialog; it is never echoed
H="Authorization: Bearer $(osascript -e 'text returned of (display dialog "CRON_SECRET" default answer "" with hidden answer)')"
BASE=https://nest-ruby-theta.vercel.app
curl -s -H "$H" $BASE/cron/pm/refresh   | jq '.sources[] | {source, ok, chars, error}'
curl -s -H "$H" $BASE/cron/pm/targets   | jq '.[] | {tier, ok, malls, categories, error}'
curl -s -H "$H" $BASE/cron/pm/knowledge | jq
curl -s -H "$H" "$BASE/cron/pm/feedback?limit=100" | jq '{answers, up, down, avgSeconds, avgOutputTokens, disliked}'
curl -s -H "$H" "$BASE/cron/pm/watch?dry=1" | jq '.signals'   # what the alerts would say now; sends nothing
curl -s -H "$H" $BASE/cron/pm/memory | jq
curl -s -H "$H" $BASE/cron/pm/golden | jq '.[] | {id, pass: .last.pass, failures: .last.failures}'
```

Ask the user before running them: `refresh` rebuilds the snapshot (several API calls, up to a minute), `targets` signs in to each test environment. Neither writes to Jira/Confluence/GitHub/Figma or the admin API. Do not call `/cron/pm/daily` to "test" — it posts the digest to the team chat.

Reading the results:
- `refresh` → one entry per source (issues, docs, code, design) with `ok`, `chars`, `error` and a 400-char `preview`. A failed source keeps its previous text marked stale, so `ok: false` with a non-zero `chars` means old data is being served.
  - GitHub 401 → `PM_GITHUB_TOKEN` expired or revoked; 404 on a repo → the fine-grained token does not include that repo or `PM_GITHUB_ORG`/`PM_GITHUB_REPOS` is misspelt.
  - Figma 403/401 → `PM_FIGMA_TOKEN` lacks access to the file (wrong team/account or missing scope), or a key in `PM_FIGMA_FILE_KEYS` is wrong.
  - Jira/Confluence 401 → `JIRA_API_TOKEN`/`JIRA_EMAIL` mismatch; empty issues → `PM_JIRA_PROJECTS` keys; empty docs → `PM_CONFLUENCE_PAGE_IDS`.
  - `chars: 0` with `ok: true` → the source is not configured (env empty), not a failure.
- `targets` → per tier (`dev`, `staging`): `ok`, counts of malls and categories, `sampleMalls`.
  - `invalid_credentials` → wrong account for that tier (`DEV_ADMIN_*` vs `STAGING_ADMIN_*` swapped or stale).
  - "write conflict or deadlock" → parallel calls on one session; `HttpStagingAdmin` now runs requests through a serial queue, so seeing it again means something bypasses `serial()`.
  - Host refused / fail-closed error → base URL not HTTPS, host not in `*_ALLOWED_HOSTS`, or it matches `STAGING_FORBIDDEN_HOSTS`.
- `knowledge` → keys, `chars`, `updatedAt` only (never the text). Upload/replace: `PUT /cron/pm/knowledge/:key` with `{ "text": ... }` (≤ 20 000 chars, key `[a-z0-9][a-z0-9:_-]{1,60}`); `DELETE` removes it. Knowledge is part of the cached prompt, so keep it lean.

"Бот не отвечает про проект": check the chat is a PM chat (`/status` answers only there), then `refresh`, then `npx vercel logs <deployment-url>` for the webhook call. A slow answer is not retried — the webhook claims each `update_id` once.

## Chat controls

- `/pm_on`, `/pm_off` — owner only, in a group: switch that chat to PM mode and into the digest (stored in `pmchats`), or back to the persona. In a private chat the bot asks to use it in the group.
- `/status` — verdict, focus per person, risks. `/refresh` — owner only, rebuilds the snapshot.
- Actions: the reply to a proposal carries ✅ Confirm / ❌ Cancel inline buttons (callback data `c:<id>` / `x:<id>`) and ends with `/confirm <id>` and `/cancel <id>`; a bare "да" (or yes/ok) confirms the newest pending action in that chat. A press from someone without rights only gets a toast, and the buttons stay.
- Choices: `offer_choices` attaches up to 6 option buttons (`o:<n>`). A press becomes the message "Выбираю вариант: <label>", with the label read back from the message itself, and the bot then proposes right away. The webhook must allow `callback_query` updates; the cold-start registration sets that. Proposals expire after 10 minutes, run once, never retry automatically; outcome is `done`, `failed` or `unknown` — on `unknown` check the environment by hand before proposing again.
- Who may confirm: the owner (`TELEGRAM_OWNER_ID`) and ids in `PM_ACTION_USER_IDS`. `TELEGRAM_PM_CHAT_IDS` and `PM_ACTION_USER_IDS` accept `owner` as a shorthand for the owner id.

## Daily digest

Vercel Cron calls `GET /cron/pm/daily` weekdays at 05:00 UTC (`0 5 * * 1-5`). It refreshes the snapshot, then posts to `PM_DIGEST_CHAT_ID` plus every chat switched on with `/pm_on`. Unset `PM_DIGEST_CHAT_ID` and no `/pm_on` chats = refresh only. Missed digest: `npx vercel logs` around 05:00 UTC, then the `refresh` check above.

## Changing configuration

Everything is env (names in `CLAUDE.md` → Environment Variables):
- Scope and people: `TELEGRAM_PM_CHAT_IDS`, `PM_DIGEST_CHAT_ID`, `PM_ACTION_USER_IDS`, `TELEGRAM_OWNER_ID`.
- Project context: `PM_PROJECT_BRIEF` (single line; write `\n` for newlines), `PM_RELEASE_DATE` (`YYYY-MM-DD`), `PM_SNAPSHOT_MAX_AGE_HOURS` (default 30).
- Jira / Confluence: `PM_JIRA_PROJECTS`, `PM_RELEASE_VERSION` (fixVersion = release scope for the computed forecast), `PM_JIRA_SPRINT_FIELD` (default `customfield_10020`), `PM_CONFLUENCE_PAGE_IDS`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`.
- GitHub: `PM_GITHUB_TOKEN`, `PM_GITHUB_ORG`, `PM_GITHUB_REPOS`, `PM_GITHUB_COMPARES` (`repo:base...head`), `PM_CODE_REPOS`.
- Figma: `PM_FIGMA_TOKEN`, `PM_FIGMA_FILE_KEYS`.
- Model: `PM_AI_MODEL` (default `claude-opus-5-5`), `PM_AI_EFFORT`, `PM_DIGEST_EFFORT` (default high).
- Test environments: `DEV_` / `STAGING_` + `API_BASE_URL`, `ALLOWED_HOSTS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`; `STAGING_FORBIDDEN_HOSTS` applies to both.

Vercel does not apply env changes to running deployments. After any change, redeploy with an empty commit to `master` (ask the user first — it ships production):

```bash
git checkout master && git pull
git commit --allow-empty -m "chore(ci): redeploy to pick up <what changed>"
git -c credential.helper='!gh auth git-credential' push
```

Then watch `npx vercel ls nest` until `● Ready` and rerun the relevant health check.

## Secrets

`!` commands in Claude Code cannot prompt for input, and a secret on the command line lands in shell history and the transcript. Ask the user to run this pattern themselves (it opens a hidden macOS dialog); verify the new value against its own API first, then replace it in Vercel:

```bash
NAME=PM_FIGMA_TOKEN
V=$(osascript -e 'text returned of (display dialog "New value for '"$NAME"'" default answer "" with hidden answer)') && [ -n "$V" ] || echo "cancelled"
# 1. verify against the API (example for Figma; GitHub: api.github.com/user with "Authorization: Bearer")
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Figma-Token: $V" https://api.figma.com/v1/me
# 2. replace in Vercel only if step 1 printed 200
npx vercel env rm "$NAME" production -y
printf %s "$V" | npx vercel env add "$NAME" production
unset V
```

Never echo `$V`, never `vercel env pull` into the repo, never store a secret in memory files. Redeploy afterwards (above), then run the health check.

## Costs and limits

- Every answer is Opus 5.5 at high effort; the system prompt (brief, snapshot, knowledge) is prompt-cached, so repeated questions within the cache window are cheaper — large knowledge uploads make every call dearer.
- Tool loop: at most 8 iterations and 16 tool calls, plus a deadline inside Vercel's 300 s; then a final answer is forced.
- The admin API of the test environments allows about 10 requests per minute; `targets` and actions share that budget.
- A refresh costs GitHub/Figma/Atlassian rate limit only; the digest runs once per weekday.
