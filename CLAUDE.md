# CLAUDE.md — NestJS E-Commerce API

## Project Overview

NestJS REST API with Clean Architecture. MongoDB via Mongoose. JWT authentication. Swagger docs at `/api/docs`.

**Stack:** NestJS 9 · MongoDB (Atlas) · Mongoose · Passport JWT · Swagger · Handlebars (email) · Tesseract.js (OCR) · Vercel (deployment)

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
│   └── shopping-cart/use-cases/    # CreateCart, AddItem, GetCart, CompleteOrder
│
├── infrastructure/
│   ├── database/
│   │   ├── schemas/                 # Mongoose schemas (UserDocument, ProductDocument, ShoppingCartDocument)
│   │   ├── mappers/                 # DB doc → Domain entity (UserMapper, ProductMapper, ShoppingCartMapper)
│   │   └── repositories/           # MongoUserRepository, MongoProductRepository, MongoShoppingCartRepository
│   └── http/
│       ├── user/                    # Controller + DTO + Module
│       ├── auth/                    # Controller + DTOs + Guards + Strategies + Module
│       ├── product/                 # Controller + Module
│       └── shopping-cart/          # Controller + Module
│
├── route/app/app.module.ts          # Root module — imports infrastructure modules
└── route/email/                     # Email module (not yet migrated to Clean Architecture)
```

### DI Tokens
```typescript
USER_REPOSITORY         // IUserRepository
PRODUCT_REPOSITORY      // IProductRepository
SHOPPING_CART_REPOSITORY // IShoppingCartRepository
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
MONGODB_URI=            # MongoDB connection string (falls back to hardcoded Atlas URL)
JWT_SECRET=             # JWT signing secret
MAIL_HOST=
MAIL_PORT=
MAIL_USER=
MAIL_PASS=
MAIL_SENDER=
APP_NAME=
B_API_KEY=              # Binance API key
B_API_SECRET=           # Binance API secret
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
| GET | `/api/docs` | — | Swagger UI |

---

## Testing

Tests live in `src/route/*/test/` directories. Run with `npm test`.

Use cases in `src/application/` can be unit-tested without any NestJS or MongoDB setup — just mock the repository interface.

```typescript
// Example: unit test for CreateUserUseCase
const mockRepo: IUserRepository = { create: jest.fn().mockResolvedValue(user), ... };
const useCase = new CreateUserUseCase(mockRepo);
```

---

## Legacy Code

`src/route/` still contains the old modules (auth, user, product, shoppingCart). They are **no longer used** — `app.module.ts` now imports from `src/infrastructure/http/`. The old files can be cleaned up once confirmed stable.

`src/route/email/` is still active — it has not been migrated to Clean Architecture yet.