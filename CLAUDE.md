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
│       ├── shopping-cart.entity.ts  # ShoppingCart + calculatePrice() static method
│       └── shopping-cart.repository.interface.ts
│
├── application/                     # Use cases — one file per operation
│   ├── user/use-cases/              # GetUsers, CreateUser, GetById, GetByEmail, Update, Delete, UpdateShoppingCart
│   ├── auth/use-cases/              # Login, Register, RefreshToken, GetProfile
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
├── route/app/app.module.ts          # Root module — imports infrastructure modules
└── route/email/                     # Email module (not yet migrated to Clean Architecture)
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
`ShoppingCart.calculatePrice(items)` lives in the entity, not the repository.

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
CORS_ORIGIN=            # Comma-separated allowed CORS origins; unset = open
ENV=
PORT=3000
```

> ⚠️ The MongoDB URI and JWT secret should always come from env vars, never hardcoded.

---

## Authentication Flow

- **Local strategy** (`POST /auth/login`) → `LoginUseCase` validates credentials, returns tokens
- **JWT strategy** (`Authorization: Bearer <token>`) → guards protected routes
- JWT payload: `{ email: string }` — extractable from `req.user.email.email` in controllers (nested due to strategy wrapping)

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | — | Login, returns accessToken + refreshToken |
| POST | `/auth/registration` | — | Register new user |
| GET | `/auth/profile` | JWT | Get current user profile |
| POST | `/auth/refresh-token` | — | Decode/refresh token |
| GET | `/user` | JWT | List all users |
| POST | `/user` | — | Create user |
| GET | `/user/:id` | JWT | Get user by ID |
| PATCH | `/user/:id` | JWT | Update user |
| DELETE | `/user/:id` | JWT | Delete user |
| GET | `/product?page=1&limit=10` | — | Paginated products |
| POST | `/product` | — | Add product |
| GET | `/product/:id` | — | Get product by ID |
| POST | `/shoppingCart/createShoppingCart` | JWT | Create cart for user |
| POST | `/shoppingCart/addItem` | JWT | Add item `{ itemID, count }` |
| GET | `/shoppingCart` | JWT | Get user's cart |
| POST | `/shoppingCart/completeOrder` | JWT | Complete order, clear cart |
| POST | `/mcp` | Bearer `MCP_TOKEN` | MCP Streamable HTTP endpoint, tool `ask_advice { prompt, context?, model? }` |
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

`src/route/` still contains the old modules (auth, user, product, shoppingCart). They are **no longer used** — `app.module.ts` now imports from `src/infrastructure/http/`. The old files can be cleaned up once confirmed stable.

`src/route/email/` is still active — it has not been migrated to Clean Architecture yet.