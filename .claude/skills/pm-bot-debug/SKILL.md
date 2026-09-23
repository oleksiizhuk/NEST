---
name: pm-bot-debug
description: Diagnose the Telegram PM bot in production — silent bot, wrong or stale answers, failed actions (brand create/publish/delete), failed deploys. Use for "бот не отвечает", "бот ответил не то", "не создался бренд", "деплой упал", "debug the telegram bot". Not for shipping (deploy) or editing the bot's knowledge docs (pm-bot-knowledge).
---

# PM bot debug

The bot runs inside the Vercel function (`api/index.js` → `dist/main`). Telegram posts to `POST /telegram/webhook`; the controller dedupes by `update_id`, then `HandleTelegramMessageUseCase` routes the message: PM chats get the project manager (`AnthropicProjectManagerService`, tool loop), every other chat gets the joke persona. Vercel runtime logs are the main evidence; Hobby keeps about an hour. Read only: no secrets printed, no test messages or actions sent without asking.

## Symptom → check → fix

| Symptom | Check | Fix |
|---|---|---|
| Silent everywhere | Logs for `/telegram/webhook` (procedure 1) | No requests → webhook lost; 401 → secret mismatch |
| Answers as the joke persona in the team chat | Chat is not in PM mode | Owner sends `/pm_on` in that chat, or add its id to `TELEGRAM_PM_CHAT_IDS` |
| "Что-то пошло не так 😢" / very slow answer | `pm answer#N` and `pm tools:` lines (procedure 3) | Narrow the question; look for a failing tool or a timed-out call |
| Wrong or stale facts | `GET /cron/pm/refresh` preview per source (procedure 4) | `/refresh` in the chat; outdated docs → `pm-bot-knowledge` skill |
| "Нет действий, ожидающих подтверждения." | Proposal expired (10 min) or never made | Ask the bot to propose again, then `/confirm <id>` or "да" |
| "Нет прав на подтверждение действий." | Sender id not in `PM_ACTION_USER_IDS` | Add the Telegram user id, redeploy |
| "Не получилось: <tier> ответил 400 — …" | The message is the API's validation text | Fix the input (name, mall, category) and propose again |
| `… ответил 429` / "rate limit, retry after Ns" | ~10 req/min per environment | Wait the given seconds; avoid bulk actions |
| "write conflict or deadlock" | Parallel requests on one admin session | Every call must go through the serial `queue` in `HttpStagingAdmin` — look for a bypass |
| `invalid_credentials` / 401 on login | `<PREFIX>_*` credentials belong to another tier | Fix the env vars for that tier, redeploy; `GET /cron/pm/targets` confirms sign-in |
| "Результат неизвестен (таймаут…)" (status `unknown`) | Timeout or 5xx — the write may have happened | Check the environment before retrying, never retry blindly |
| Deploy "Checks for Deployment have failed" | Build/boot error (procedure 6) | Prod alias stays on the old deployment; fix and push |
| New env value has no effect | Deployment predates the change | Redeploy (procedure 7) |

Every confirmed action is audited in the Mongo collection `pmactions` (status `done` / `failed` / `unknown`, result text, timestamps).

## 1. Bot silent everywhere

```bash
npx vercel logs --since 1h --json > "$TMPDIR/vlogs.json"
python3 - "$TMPDIR/vlogs.json" <<'EOF'
import json, re, sys
ansi = re.compile(r'\x1b\[[0-9;]*m')
for line in open(sys.argv[1]):
    line = ansi.sub('', line).strip()
    if not line.startswith('{'):
        continue
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if '/telegram/webhook' not in str(e.get('requestPath', '')):
        continue
    print(e.get('timestamp'), e.get('responseStatusCode'), ansi.sub('', str(e.get('message', '')))[:200])
EOF
```

- **No webhook requests at all** → the webhook is gone. A local polling run with the same `TELEGRAM_TOKEN` deletes it. `TelegramWebhookBootstrap` re-registers it on every production cold start from `TELEGRAM_WEBHOOK_URL` (or `VERCEL_PROJECT_PRODUCTION_URL`): redeploy, or hit any endpoint on a fresh instance. Look for `Telegram webhook set to … (was: …, pending: …, last error: …)` in the logs; "not registered: set TELEGRAM_WEBHOOK_SECRET…" means an env var is missing.
- **401 responses** → `TELEGRAM_WEBHOOK_SECRET` differs from the secret the webhook was registered with (`X-Telegram-Bot-Api-Secret-Token`). Fix the value and redeploy; the cold start re-registers with the new secret.
- **200 but no reply** → go to procedure 3.

## 2. Persona instead of PM in the team chat

PM mode is per chat: `TELEGRAM_PM_CHAT_IDS` plus chats toggled with `/pm_on` / `/pm_off` (stored in Mongo). `/pm_on` works only in a group and only from the owner. Private chats and unknown groups always get the persona, which has no project access.

## 3. "Что-то пошло не так" or slow answers

Filter the same log dump on `pm ` messages instead of the request path:

- `pm answer#N: <model> <stop_reason> in=… cache_read=… cache_write=… out=… 12.3s` — one line per model call. Many iterations, huge `in=` with `cache_read=0`, or a single call of 100 s+ explains slowness.
- `pm tools: name1, name2 (N chars so far)` — which tools ran. A tool erroring each round means a broken source or target.
- Limits: 240 s answer budget, at most 8 iterations / 16 tool calls / 150k tool chars, then the model is forced to wrap up. The function itself stops at 300 s.
- Telegram resends an update when the reply takes long; the `update_id` claim drops the copy, so a duplicate question in the logs does not mean a double answer.
- `The model declined the request` → refusal; rephrase.

## 4. Wrong or stale facts

`curl -s -H "Authorization: Bearer $CRON_SECRET" https://<prod-host>/cron/pm/refresh` rebuilds the snapshot and returns per source `ok`, `chars`, `error` and a 400-char `preview` (the value comes from the user's env, never echoed). A source with `ok: false` explains "could not read …" answers. In the chat, `/refresh` does the same. If the sources are fine but the curated knowledge is outdated, use the `pm-bot-knowledge` skill.

## 5. Action problems

Flow: the model proposes → the bot shows the summary with `/confirm <id>` / `/cancel <id>` (valid 10 minutes) → an authorised user confirms → the call goes to the test environment through the serial queue. Match the reply text to the table above; the `pmactions` row holds the raw error in brackets.

## 6. Deploy failed

A failed deployment never takes the alias: production keeps serving the previous build. Most boot failures are Nest DI errors ("can't resolve dependencies"), which `src/infrastructure/http/project-manager/__tests__/pm-modules.di.spec.ts` should catch first — run `npm test -- pm-modules`. To reproduce the boot locally (macOS has no `timeout`):

```bash
npm run build
MONGODB_URI='mongodb://127.0.0.1:1/fake' node dist/main.js > "$TMPDIR/boot.log" 2>&1 &
PID=$!; sleep 10; kill $PID 2>/dev/null
grep -iE "can't resolve|cannot find module|error" "$TMPDIR/boot.log" | head
```

A Mongo connection error is expected with the fake URI; a DI or module error is the bug. Build logs: `npx vercel inspect <deployment-url> --logs`.

## 7. Env change not visible

Env vars apply only to new deployments. Redeploy without code changes:

```bash
git commit --allow-empty -m "chore(ci): redeploy to pick up env changes"
git -c credential.helper='!gh auth git-credential' push
```

(Commit and push only when the user asked — see the `deploy` skill.)
