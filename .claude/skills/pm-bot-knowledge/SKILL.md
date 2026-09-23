---
name: pm-bot-knowledge
description: Keep the Telegram PM bot's knowledge current — the project brief (PM_PROJECT_BRIEF) and the long-lived reference docs in Mongo (codebase maps, design map, API notes). Regenerate maps with read-only subagents, upload them, replace the brief, verify. Use for "обнови карту кода", "бот не знает про", "обнови бриф", "refresh the bot's knowledge", "codebase map". Not for code changes to the bot itself (new-feature) or plain deploys (deploy).
---

# PM bot knowledge

The repo is **public**. Nothing project-specific goes into git, this file, commit messages or PRs: no client or repo names, hosts, accounts, people or secrets. Refer to "the client's repositories (`PM_CODE_REPOS` / `PM_GITHUB_REPOS`)" and "the design file (`PM_FIGMA_FILE_KEYS`)"; read the actual values from Vercel env when needed and keep them in the scratchpad.

## Three layers

| Layer | Where | Size | Refresh when |
|---|---|---|---|
| Brief | Vercel env `PM_PROJECT_BRIEF` (`pm.config.ts`) | ~5 KB | team, roles, process, critical path or deadline change |
| Knowledge docs | Mongo `pmknowledges`, keys like `map:mobile`, `map:backend`, `map:dashboard`, `map:design`, `note:staging-api` | ≤ 20 000 chars each | structure, modules, API or design changed noticeably; the bot answers "where is X" wrongly |
| Snapshot | Mongo, built by `RefreshProjectSnapshotUseCase` from Jira/Confluence/GitHub/Figma | automatic | never by hand — daily cron, `/refresh` (owner), or on demand when older than `PM_SNAPSHOT_MAX_AGE_HOURS` |

Prompt order (`AnthropicProjectManagerService.system`): instructions → `<knowledge>` (all docs, `renderKnowledge` wraps each in `<doc key="...">`, 1 h cache breakpoint) → `<brief>` + snapshot (second 1 h breakpoint). Every doc is sent on every question, so keep them dense and delete keys that are no longer useful.

## Regenerate maps

Launch the subagents **in one message, in parallel**: one per client repository, plus one for the design file using the Figma MCP read tools only (`get_metadata`, `get_design_context`, `get_screenshot`, `get_variable_defs`). Each writes its map to the scratchpad; the main session reviews and uploads.

Prompt template (fill `<...>` in the session, never in a committed file):

```
Read-only task. Build a reference map of one repository for a project-manager bot.
Clone: gh repo clone <org>/<repo> <scratchpad>/maps/<key> -- --depth 20 --branch staging
(if there is no staging branch, use the default branch and say so).
Do NOT edit, commit, push, open PRs or call any live service.
Write plain text, 6 000–9 000 chars, to <scratchpad>/maps/<key>.txt with exactly these sections:
1. Purpose, stack, branch flow (which branch deploys where, in words, no URLs)
2. Structure — top-level folders and what lives in each
3. Modules / features — each with its routes, screens or endpoints and main files
4. Data model — entities, key fields, relations
5. Auth and roles — how login works, which roles exist, what they can do
6. Cross-cutting — config, i18n, errors, logging, tests, CI
7. Where to look — cheat-sheet "question → path"
Rules: no secrets, tokens, keys, passwords, hostnames, IPs, emails or env values —
name the variable instead (e.g. "API base URL from env API_URL"). Paths relative to repo root.
Report: the file path and its char count.
```

For the design file: same sections adapted — pages, flows per page, key frames by name, components/tokens, open questions — written to `<scratchpad>/maps/map-design.txt`.

Before uploading, scan every file and fix hits by hand:

```bash
grep -nEi '(https?://|[a-z0-9-]+\.(com|io|app|net|dev)\b|@[a-z0-9-]+\.|sk-|ghp_|xox|eyJ|AKIA|password|secret|token *[:=])' <scratchpad>/maps/*.txt
wc -c <scratchpad>/maps/*.txt   # each must be ≤ 20000
```

## Upload, list, delete

`/cron/pm/knowledge` is guarded by `CRON_SECRET` (`PmKnowledgeController`). Key must match `^[a-z0-9][a-z0-9:_-]{1,60}$`; text 1–20 000 chars. Ask the user to put the secret in a scratchpad file (Vercel returns sensitive values masked); read it with `$(cat ...)` so it never lands in output or shell history.

```bash
API=https://<host>                    # production base URL
SECRET_FILE=<scratchpad>/cron_secret  # one line, chmod 600
KEY=map:backend; SRC=<scratchpad>/maps/map-backend.txt
python3 -c 'import json,sys; print(json.dumps({"text": open(sys.argv[1]).read()}))' "$SRC" > "$SRC.json"
curl -sS -X PUT "$API/cron/pm/knowledge/$KEY" \
  -H "Authorization: Bearer $(cat "$SECRET_FILE")" \
  -H 'Content-Type: application/json' --data-binary @"$SRC.json"
# → {"key":"map:backend","chars":8123}

curl -sS "$API/cron/pm/knowledge" -H "Authorization: Bearer $(cat "$SECRET_FILE")"          # key, chars, updatedAt — never text
curl -sS -X DELETE "$API/cron/pm/knowledge/$KEY" -H "Authorization: Bearer $(cat "$SECRET_FILE")"
```

A 400 means a bad key or text over 20 000 chars; 401/403 means a wrong secret. Uploads take effect on the next question (no redeploy); the knowledge cache block is rewritten once.

## Update the brief

1. Write the new brief to `<scratchpad>/brief.txt`: team and roles, process (sprints, reviews, release flow), critical path, deadline, known risks. ~5 KB, no secrets.
2. Vercel env values are single-line; `pm.config.ts` turns a literal `\n` back into a newline. Flatten:
   `python3 -c 'import sys; sys.stdout.write(open(sys.argv[1]).read().strip().replace("\n","\\n"))' <scratchpad>/brief.txt > <scratchpad>/brief.env`
3. Replace the variable (value from a file, never on the command line):
   `npx vercel env rm PM_PROJECT_BRIEF production -y && npx vercel env add PM_PROJECT_BRIEF production < <scratchpad>/brief.env`
4. Env applies only to **new** deployments — redeploy with an empty commit on `master` (ask first):
   `git commit --allow-empty -m "chore(ci): redeploy to pick up the new PM brief"` then push per the deploy skill, and wait for `● Ready`.

## Verify

- Ask the bot in a PM chat a question only the new material answers ("where is the payment screen implemented?", "who reviews backend PRs?"). The answer should cite the right paths / people.
- Ask a second question within the hour and check `npx vercel logs <deployment-url>` for the `pm ...` line: `cache_read` > 0 on the second call means the knowledge block is cached; a large `cache_write` on every call means something in the prefix keeps changing.
- If the bot still does not know: `GET /cron/pm/knowledge` to confirm the key and size, then check the doc actually contains the answer.
