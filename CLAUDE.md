# CLAUDE.md — NestJS E-Commerce API

## Project Overview

NestJS REST API with Clean Architecture. MongoDB via Mongoose. JWT authentication. Swagger docs at `/api/docs`.

**Stack:** NestJS 9 · MongoDB (Atlas) · Mongoose · Passport JWT · Swagger · Handlebars (email) · Tesseract.js (OCR) · Anthropic SDK + MCP (IDE bridge) · Vercel (deployment)

---

## Commands

```bash
npm run start:dev     # development with watch
npm run build         # production build
npm run start:prod    # run compiled dist
npm test              # unit tests (Jest)
npm run test:e2e      # e2e tests
npm run test:cov      # coverage report
npm run lint          # eslint --fix
npm run format        # prettier
```

---

## Architecture — Clean Architecture

The project follows Clean Architecture with strict layer boundaries. Dependencies always point **inward** (infrastructure → application → domain).

```
src/
├── domain/                          # No framework dependencies
│   ├── user/
│   │   ├── user.entity.ts           # Pure TS class with toPublicProfile()
│   │   └── user.repository.interface.ts  # IUserRepository + USER_REPOSITORY token
│   ├── product/
│   │   ├── product.entity.ts        # Product class + IPaginationProduct
│   │   └── product.repository.interface.ts
│   └── shopping-cart/
│       ├── shopping-cart.entity.ts  # ShoppingCart: addItem() + calculatePrice()
│       └── shopping-cart.repository.interface.ts
│
├── application/                     # Use cases — one file per operation
│   ├── user/use-cases/              # GetUsers, CreateUser, GetById, GetByEmail, Update, Delete, UpdateShoppingCart
│   ├── auth/                        # IPasswordHasher, ITokenService + use-cases: Login, Register, RefreshToken, GetProfile
│   ├── product/use-cases/           # GetProducts, GetProductById, AddProduct
│   ├── shopping-cart/use-cases/    # CreateCart, AddItem, GetCart, CompleteOrder
│   └── mcp/                         # ICodeAssistantService + AskClaudeUseCase
│
├── infrastructure/
│   ├── database/
│   │   ├── schemas/                 # Mongoose schemas (UserDocument, ProductDocument, ShoppingCartDocument)
│   │   ├── mappers/                 # DB doc → Domain entity (UserMapper, ProductMapper, ShoppingCartMapper)
│   │   └── repositories/           # MongoUserRepository, MongoProductRepository, MongoShoppingCartRepository
│   ├── anthropic/                   # AnthropicCodeAssistantService (Claude behind /mcp)
│   ├── mcp/                         # createMcpServer() — registers the ask_advice tool
│   └── http/
│       ├── user/                    # Controller + DTO + Module
│       ├── auth/                    # Controller + DTOs + Guards + Strategies + Module
│       ├── product/                 # Controller + Module
│       ├── shopping-cart/          # Controller + Module
│       └── mcp/                     # POST /mcp (MCP Streamable HTTP) + bearer guard + Module
│
└── route/app/app.module.ts          # Root module — imports infrastructure modules
```

### DI Tokens
```typescript
USER_REPOSITORY         // IUserRepository
PRODUCT_REPOSITORY      // IProductRepository
SHOPPING_CART_REPOSITORY // IShoppingCartRepository
CODE_ASSISTANT_SERVICE  // ICodeAssistantService (Anthropic behind /mcp)
```

Binding happens in each module's `providers`:
```typescript
{ provide: USER_REPOSITORY, useClass: MongoUserRepository }
```

---

## Key Conventions

### Adding a new feature
1. **Domain** — add entity + repository interface (no imports from NestJS)
2. **Application** — one use case per operation, inject repository via `@Inject(TOKEN)`
3. **Infrastructure/database** — add Mongoose schema + mapper + repository implementation
4. **Infrastructure/http** — thin controller that calls use case, DTO for validation, module wiring

### Naming
- Domain entities: `User`, `Product`, `ShoppingCart` (plain TS classes)
- Mongoose schemas: `UserDocument`, `ProductDocument`, `ShoppingCartDocument`
- Repositories: `MongoUserRepository`, `MongoProductRepository`
- Use cases: `<Action><Entity>UseCase` → `CreateUserUseCase`, `GetProductByIdUseCase`
- Mappers: `UserMapper.toDomain(doc)` — static methods only

### Controllers are thin
Controllers only handle HTTP concerns (parsing request, calling use case, returning response). No business logic in controllers.

### Business logic in domain
`ShoppingCart.addItem()` and `calculatePrice(items)` live in the entity, not the repository.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```
MONGODB_URI=            # MongoDB connection string (required, the app fails to start without it)
JWT_SECRET=             # JWT signing secret
MAIL_HOST=
MAIL_PORT=
MAIL_USER=
MAIL_PASS=
MAIL_SENDER=
APP_NAME=
B_API_KEY=              # Binance API key
B_API_SECRET=           # Binance API secret
ANTHROPIC_KEY=          # Anthropic API key (Telegram bot + /mcp)
MCP_TOKEN=              # Bearer token an IDE must send to POST /mcp (unset = closed)
MCP_AI_MODEL=           # Default model for ask_advice: opus|sonnet|fable or raw id, default opus
MCP_AI_EFFORT=          # low|medium|high|xhigh|max, default high
MCP_DAILY_LIMIT=        # Hard cap on /mcp calls per UTC day (Mongo counter); unset/0 = no cap
TELEGRAM_WEBHOOK_URL=   # Public webhook URL the prod app registers with Telegram on cold start
CORS_ORIGIN=            # Comma-separated allowed CORS origins; unset = open
TELEGRAM_PM_CHAT_IDS=   # Chats where the bot is project manager ("owner" = TELEGRAM_OWNER_ID); others get the persona
PM_DIGEST_CHAT_ID=      # Chat for the weekday digest; unset = refresh only
PM_RELEASE_DATE=        # YYYY-MM-DD the team is aiming at
PM_PROJECT_BRIEF=       # Team, process, risks — project-specific, never committed
PM_AI_MODEL=            # default claude-opus-5-5; PM_AI_EFFORT / PM_DIGEST_EFFORT default high
PM_JIRA_PROJECTS=       # e.g. ABC,XYZ (uses JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN, read-only)
PM_RELEASE_VERSION=     # Jira fixVersion that is the release scope for the computed forecast; unset = all open issues
PM_JIRA_SPRINT_FIELD=   # Sprint custom field id, default customfield_10020
PM_JIRA_BOARD_ID=       # Jira board for the jira_sprint tool (active sprint); unset = off
PM_ADMIN_EMAIL=         # Optional password login to /admin, with PM_ADMIN_PASSWORD_HASH (bcrypt hash, never the password); 5 failures in 15 min lock it
PM_IN_OWNER_GROUPS=     # Default true: every group TELEGRAM_OWNER_ID is in is a PM chat; groups without the owner get a polite pointer, no project data, no model call
PM_ADMIN_URL=           # Origin of the /admin page for login links; default: TELEGRAM_WEBHOOK_URL's origin
PM_DAILY_QUESTION_LIMIT= # Questions to the model per person per UTC day (default 7, 0 = off); owner and PM_UNLIMITED_USERNAMES (usernames, no @) are exempt
PM_ALERT_CHAT_IDS=      # Who gets proactive alerts and the weekly eval report; default "owner" (TELEGRAM_OWNER_ID's DM) only
PM_CONFLUENCE_PAGE_IDS= # Comma-separated page ids re-read on every refresh
PM_CONFLUENCE_SPACES=   # Space keys the bot may search/read on demand; PM_CONFLUENCE_EXCLUDE_PAGE_IDS never readable; PM_CONFLUENCE_ALLOW_PAGE_IDS lifts only the access-title filter for those pages (and as ancestors)
PM_KNOWLEDGE_INLINE_CHARS= # Total knowledge chars inlined in every prompt (default 60000); above it the largest docs go to an index read with read_knowledge. Upload cap 20000 chars per doc, 60000 for ref:* keys
PM_GITHUB_TOKEN=        # Fine-grained, read-only; with PM_GITHUB_ORG, PM_GITHUB_REPOS, PM_GITHUB_COMPARES (repo:base...head)
PM_FIGMA_TOKEN=         # Figma personal token (read: file content, comments, versions) with PM_FIGMA_FILE_KEYS
CRON_SECRET=            # Bearer secret Vercel Cron sends to /cron/pm/*
PM_CODE_REPOS=          # Repos the bot may read code from (defaults to PM_GITHUB_REPOS)
PM_ACTION_USER_IDS=     # Telegram user ids besides the owner who may /confirm staging actions
PM_DM_USERNAMES=        # Telegram usernames (no @) of team members who may DM the bot; their DMs get PM mode, confirming still needs PM_ACTION_USER_IDS
PM_TEAM=                # Team members' display names across Jira/Confluence/Figma; a reply from one of them answers an open question
STAGING_API_BASE_URL=   # Staging admin API; with STAGING_ALLOWED_HOSTS (exact hosts) and STAGING_FORBIDDEN_HOSTS (e.g. the prod domain)
STAGING_ADMIN_EMAIL=    # Dedicated least-privilege staging account for the bot, with STAGING_ADMIN_PASSWORD
DEV_API_BASE_URL=       # Same four settings for the dev environment (DEV_ALLOWED_HOSTS, DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD); STAGING_FORBIDDEN_HOSTS applies to both
<P>_CLIENT_EMAIL=       # Per environment (P = DEV / STAGING): client account (falls back to <P>_ADMIN_*); <P>_PLATFORM_ADMIN_EMAIL/PASSWORD = platform admin. Tools take as=client|admin
ENV=
PORT=3000
```

> ⚠️ The MongoDB URI and JWT secret should always come from env vars, never hardcoded.

---

## Telegram project-manager mode

In chats listed in `TELEGRAM_PM_CHAT_IDS`, chats switched on with `/pm_on`, and (by default, `PM_IN_OWNER_GROUPS`) every group the owner is a member of (checked with getChatMember, cached 10 min), the bot answers as a delivery manager on `claude-opus-5-5`. `/pm_off` is stored and beats the automatic mode. Groups without the owner get a short polite reply and never see project data; the persona remains only in private chats outside PM mode.
- `RefreshProjectSnapshotUseCase` reads Jira, Confluence, GitHub and Figma (pages/frames, recent versions, open comments) through read-only `IProjectSource`s (`src/infrastructure/project-manager/`) into a `ProjectSnapshot` in Mongo. A failed source keeps its previous text, marked stale.
- `AnswerProjectQuestionUseCase` answers from the latest snapshot plus `PM_PROJECT_BRIEF`; crons keep the snapshot fresh, and it is built inline only when none exists (its age is shown to the model). The Jira and GitHub sections start with a "Computed metrics" block counted in code (`application/project-manager/metrics.ts`): scope, 14-day pace, forecast with a verdict hint, unassigned/stale/overdue items, bugs, load per person, PRs waiting for review, red pipelines. Instructions are generic and live in the repo; everything project-specific comes from env and the snapshot, because the repo is public.
- Commands: `/status` (verdict, focus per person, risks), `/refresh` (owner only). In a group the owner sends `/pm_on` to switch that chat to PM mode and add it to the digest (stored in Mongo `pmchats`), `/pm_off` to switch it back; nobody else can.
- `PostDailyDigestUseCase` runs from Vercel Cron on weekdays and posts to `PM_DIGEST_CHAT_ID`.
- The webhook claims each `update_id` in Mongo first, so Telegram's retry of a slow answer is ignored.
- Tools (`PmToolbox`, application layer): `search_code`, `read_file`, `list_dir`, `get_pull_request` over the allowlisted repos (read-only; `.env`/key files refused, secrets masked, output wrapped as `<tool_data>`), `staging_lookup`, and `propose_create_brand`. The loop in `AnthropicProjectManagerService` is bounded (8 iterations, 16 calls, deadline) and forces a final answer with `tool_choice: none`.
- Actions target a test environment (`dev` or `staging`, `AdminTargets` builds one client per configured `DEV_*` / `STAGING_*` prefix) and are never executed by the model: `propose_create_brand` stores a `PendingAction` (Mongo `pmactions`, 10 min) and the reply gets a `/confirm <id>` line. `ConfirmPendingActionUseCase` runs it only for the owner or `PM_ACTION_USER_IDS`, claims it atomically, re-checks for a duplicate, and records the outcome (`done` / `failed` / `unknown`, no automatic retry). `HttpStagingAdmin` fails closed unless the base URL is HTTPS on an allowlisted host.
- `PUT /cron/pm/knowledge/:key` (CRON_SECRET) stores reference text such as codebase maps in Mongo `pmknowledges`. `core:brief` replaces `PM_PROJECT_BRIEF` without a redeploy; `ref:*` keys and the largest docs over `PM_KNOWLEDGE_INLINE_CHARS` are listed in a `<doc_index>` and read with `read_knowledge`; the rest is loaded into the cached prompt with its update date. `GET` lists keys and sizes only.
- Each refresh keeps the computed numbers per section, and the next snapshot shows the change since yesterday and since a week ago. The digest sees its previous digest (stored on the snapshot).
- Proactive alerts (`WatchProjectUseCase`): readers emit signals (blocker, unassigned high-priority release work, release branch red over 2 h, PR waiting for review); the watch adds client questions unanswered over 2 working days (needs `PM_TEAM`), overdue commitments from memory, and a readiness checklist at 5/2/1 working days before `PM_RELEASE_DATE`. Each rule+subject is sent once per chat (`pmalerts`, 30 days); no model call.
- Long-term memory (`pmmemories`): `propose_remember` stores a proposal; after Confirm it is saved with an expiry (decision 90 d, fact 30 d, commitment due + 7 d, person kept). It rides in the brief block as `<memory>`. `/memory` lists, `/forget <id>` removes (authorised only).
- `jira_sprint` (with `PM_JIRA_BOARD_ID`) and `release_checklist` (gates from the snapshot numbers plus `core:dod`).
- Golden eval (`RunGoldenEvalUseCase`): cases from `PUT /cron/pm/golden` run weekly through the answer pipeline (chat 0), checked by mustContain / mustNotContain (`/regex/` allowed) / maxSeconds; the report goes to the alert chats once a week.
- Access: only the owner may have code read or PRs reviewed in depth (`search_code`, `read_file`, `list_dir`, `get_pull_request` refuse for anyone else; the model is told to answer from the snapshot). Everyone else gets `PM_DAILY_QUESTION_LIMIT` questions a day (`pmquota`); commands and buttons do not count.
- Admin page (`admin/`, React + Vite, built on deploy into `public/admin`, served at `/admin/`): the owner sends `/admin` to the bot in private and gets a one-time link (10 min, `pmadminlogins`, only its hash stored); `POST /pm-admin/login` turns it into a 7-day session JWT (`typ: pm-admin`, `sub` = TELEGRAM_OWNER_ID). Alternatively `POST /pm-admin/password-login` with `PM_ADMIN_EMAIL` + a password checked against `PM_ADMIN_PASSWORD_HASH` followed by a Telegram prompt to the owner ("Это вы?" with Confirm / Deny, 2 minutes, `pmadminapprovals`); the page polls `POST /pm-admin/password-login/status` and gets the session once after Confirm. 5 wrong passwords or a Deny lock password login for 15 minutes; if the prompt cannot be sent, login fails closed. "Выйти везде" (`POST /pm-admin/logout-all`) raises a session epoch and ends every session. The page changes the daily limit, unlimited people, DM access, who may confirm, alert recipients and chat effort. Overrides live in `pmsettings` and win over env (`PmRuntimeConfig`, 30 s cache); an empty field resets to env. A "Сотрудники" page shows each Jira assignee's work from the latest snapshot (per-person data kept in the Jira/GitHub sections' `details` at refresh: in progress with days in status and release scope, queue, done in 14 days, open PRs and merged work via a Jira-name → GitHub-login mapping set on the page) with computed direction signals (too much WIP, stale, off-release work while release work waits, higher priority waiting, overdue, blocked, nothing closed, PRs waiting), and "Анализ для митинга": one model call (`TeamReviewUseCase`, digest effort, no tools) writing per-person notes and recommendations, cached for the day in `pmteamreviews`. It also shows today's questions per person, 👍/👎 stats, and the groups the bot has seen with a PM-mode switch (same as `/pm_on` / `/pm_off`). When Telegram turns a PM group into a supergroup (new chat id), PM mode moves to the new id automatically.
- Local project copy (`BuildIndexUseCase`, Mongo `pmindex` with a text index): every Jira ticket (any status, description, reporter, assignee, last comments), every page of `PM_CONFLUENCE_SPACES` (access pages and their subtrees skipped), Figma frames and comments, and the newest 300 PRs per repo. Collected by source APIs only — no model tokens — in resumable steps (`pmindexjob`): nightly by Vercel Cron (`/cron/pm/index`, 01:00 and 03:00 UTC) or from the admin page "Данные → Собрать всё". The bot reads it with `search_project` / `read_indexed`; items not seen by a finished run are pruned. Snapshot Jira lines also carry the reporter.
- Plain answers carry 👍/👎 buttons; the vote and the answer's tokens, time and tools are stored on the message log (`GET /cron/pm/feedback`).

---

## Authentication Flow

- `POST /auth/login` → `LoginUseCase` checks the password through `IPasswordHasher` (bcrypt) and returns `{ user, accessToken, refreshToken }`. `user` is always `toPublicProfile()`, never the password. Accounts still holding a plain-text password are rehashed on their first successful login.
- Tokens come from `ITokenService` (`JwtTokenService`): payload `{ sub, email, typ }`, where `sub` is the user id and `typ` is `access` (24h) or `refresh` (100h). A token is honoured only while that user id still owns the email, so deleting an account or changing its email invalidates its tokens. `JWT_SECRET` is required; the app refuses to start without it.
- `JwtAuthGuard` (`JwtStrategy`) accepts only `typ: 'access'` tokens and sets `req.user = { email }`. Read it in controllers with the `@CurrentUserEmail()` decorator.
- `POST /auth/refresh-token` takes the refresh token as `Authorization: Bearer <refreshToken>`, verifies it and returns a new pair.
- A user may `PATCH` / `DELETE` only their own `/user/:id` (403 otherwise). The global `ValidationPipe` rejects body fields the DTO doesn't declare.

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | — | Login, returns accessToken + refreshToken |
| POST | `/auth/registration` | — | Register new user |
| GET | `/auth/profile` | JWT | Get current user profile |
| POST | `/auth/refresh-token` | Bearer refresh token | New access + refresh token pair |
| GET | `/user` | JWT | List all users |
| POST | `/user` | — | Create user |
| GET | `/user/:id` | JWT | Get user by ID |
| PATCH | `/user/:id` | JWT, own account | Update user (partial) |
| DELETE | `/user/:id` | JWT, own account | Delete user |
| GET | `/product?page=1&limit=10` | — | Paginated products |
| POST | `/product` | JWT | Add product (`discount` is an amount, ≤ `price`) |
| GET | `/product/:id` | — | Get product by ID (the Mongo `_id`, also used as `itemID` in the cart) |
| POST | `/shoppingCart/createShoppingCart` | JWT | Create cart for user, or return the existing one |
| POST | `/shoppingCart/addItem` | JWT | Add item `{ itemID, count }` (count 1–1000) |
| GET | `/shoppingCart` | JWT | Get user's cart |
| POST | `/shoppingCart/completeOrder` | JWT | Complete order, delete the cart |
| POST | `/email/send`, `/email/sendEmailTemple` | JWT | Email the caller's own address only |
| POST | `/email/convert` | JWT | OCR an uploaded image (`file`, ≤ 5 MB) |
| POST | `/mcp` | Bearer `MCP_TOKEN` | MCP Streamable HTTP endpoint, tool `ask_advice { prompt, context?, model? }` |
| GET | `/cron/pm/actions`, `/cron/pm/ask?q=`, `/cron/pm/targets`, `/cron/pm/feedback` | Bearer `CRON_SECRET` | Diagnostics: recent actions with outcome, one question through the PM pipeline, dev/staging sign-in check, 👍/👎 and time/tokens of recent answers |
| GET | `/cron/pm/watch?dry=1`, `/cron/pm/eval`, `/cron/pm/memory`, `/cron/pm/golden` · PUT `/cron/pm/golden` | Bearer `CRON_SECRET` | Alerts (Vercel Cron 08/11/14 UTC weekdays; `dry=1` lists without sending), weekly golden eval (Mon 02:00, 03:00, 04:00 UTC), memory records, golden questions |
| GET | `/cron/pm/refresh`, `/cron/pm/daily` | Bearer `CRON_SECRET` | Rebuild the project snapshot; daily also posts the digest (Vercel Cron, weekdays 05:00 UTC) |
| GET | `/api/docs` | — | Swagger UI |

### MCP endpoint (`/mcp`)

Lets an IDE agent (Kiro, Claude Code, Cursor) call Claude through this API instead of a local install. Stateless Streamable HTTP: one `McpServer` + transport per request, JSON responses, no sessions (Vercel is serverless). GET/DELETE answer 405. `model` picks the answering model per call: `opus` (default), `sonnet`, `fable`; the short name → model id map lives in `AnthropicCodeAssistantService`. Heavy calls run 1–2 min, so the client timeout must be raised (Vercel allows 300s). Client config:

```json
{ "mcpServers": { "nest-claude": {
  "url": "https://<host>/mcp",
  "headers": { "Authorization": "Bearer <MCP_TOKEN>" }
}}}
```

---

## Testing

Specs live in `__tests__/` folders next to the code they cover. Run with `npm test`; the pre-push hook runs `npm run test:cov`.

Use cases in `src/application/` can be unit-tested without any NestJS or MongoDB setup — just mock the repository interface.

```typescript
// Example: unit test for CreateUserUseCase
const mockRepo: IUserRepository = { create: jest.fn().mockResolvedValue(user), ... };
const useCase = new CreateUserUseCase(mockRepo);
```

---

## AI tooling

Skills, agents and hooks for Claude Code are in `.claude/`; the catalog is `.claude/README.md`. Use `new-feature` to add an endpoint, `quality-gates` before a PR, `commit` / `pr` / `deploy` to ship.

---

## Legacy Code

The old `src/route/` modules have been removed; only `src/route/app/` (the root module) remains. Email now lives in `src/application/email/` and `src/infrastructure/http/email/`.