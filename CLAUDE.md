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
PM_CONFLUENCE_PAGE_IDS= # Comma-separated page ids re-read on every refresh
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

In chats listed in `TELEGRAM_PM_CHAT_IDS` the bot answers as a delivery manager on `claude-opus-5-5`. Every other chat keeps the persona and never sees project data.
- `RefreshProjectSnapshotUseCase` reads Jira, Confluence, GitHub and Figma (pages/frames, recent versions, open comments) through read-only `IProjectSource`s (`src/infrastructure/project-manager/`) into a `ProjectSnapshot` in Mongo. A failed source keeps its previous text, marked stale.
- `AnswerProjectQuestionUseCase` answers from the latest snapshot plus `PM_PROJECT_BRIEF`, rebuilding it first when it is older than `PM_SNAPSHOT_MAX_AGE_HOURS` (30). Instructions are generic and live in the repo; everything project-specific comes from env and the snapshot, because the repo is public.
- Commands: `/status` (verdict, focus per person, risks), `/refresh` (owner only). In a group the owner sends `/pm_on` to switch that chat to PM mode and add it to the digest (stored in Mongo `pmchats`), `/pm_off` to switch it back; nobody else can.
- `PostDailyDigestUseCase` runs from Vercel Cron on weekdays and posts to `PM_DIGEST_CHAT_ID`.
- The webhook claims each `update_id` in Mongo first, so Telegram's retry of a slow answer is ignored.
- Tools (`PmToolbox`, application layer): `search_code`, `read_file`, `list_dir`, `get_pull_request` over the allowlisted repos (read-only; `.env`/key files refused, secrets masked, output wrapped as `<tool_data>`), `staging_lookup`, and `propose_create_brand`. The loop in `AnthropicProjectManagerService` is bounded (8 iterations, 16 calls, deadline) and forces a final answer with `tool_choice: none`.
- Actions target a test environment (`dev` or `staging`, `AdminTargets` builds one client per configured `DEV_*` / `STAGING_*` prefix) and are never executed by the model: `propose_create_brand` stores a `PendingAction` (Mongo `pmactions`, 10 min) and the reply gets a `/confirm <id>` line. `ConfirmPendingActionUseCase` runs it only for the owner or `PM_ACTION_USER_IDS`, claims it atomically, re-checks for a duplicate, and records the outcome (`done` / `failed` / `unknown`, no automatic retry). `HttpStagingAdmin` fails closed unless the base URL is HTTPS on an allowlisted host.
- `PUT /cron/pm/knowledge/:key` (CRON_SECRET) stores reference text such as codebase maps in Mongo `pmknowledges`; it is loaded into the cached prompt. `GET` lists keys and sizes only.

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
| GET | `/cron/pm/actions`, `/cron/pm/ask?q=`, `/cron/pm/targets` | Bearer `CRON_SECRET` | Diagnostics: recent actions with outcome, one question through the PM pipeline, dev/staging sign-in check |
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