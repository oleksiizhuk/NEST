---
name: new-feature
description: Implement a new endpoint or feature through all Clean Architecture layers of this NestJS API — domain entity + repository interface, use cases, Mongoose schema + mapper + repository, DTO + thin controller + module, specs. Use when the user asks to add an endpoint, resource, use case or CRUD. Plan first with implementation-planner when the scope is unclear.
---

# New feature, layer by layer

Dependencies point inward: `infrastructure → application → domain`. Copy the closest existing slice rather than inventing a shape. `product` is the reference for a plain resource: `src/domain/product/`, `src/application/product/use-cases/`, `src/infrastructure/database/{schemas,mappers,repositories}/`, `src/infrastructure/http/product/`.

Imports use the path aliases `@domain/*`, `@application/*`, `@infrastructure/*`, `@config/*` — never long relative paths across layers.

## Steps (in dependency order)

1. **Domain** — `src/domain/<entity>/`
   - `<entity>.entity.ts`: plain TS class, no NestJS/Mongoose imports. Business rules live here (like `ShoppingCart.calculatePrice`).
   - `<entity>.repository.interface.ts`: `I<Entity>Repository` + `export const <ENTITY>_REPOSITORY = '<ENTITY>_REPOSITORY'`. Methods return domain entities, never documents.
2. **Application** — `src/application/<domain>/use-cases/`
   - One `@Injectable()` class per operation, named `<Action><Entity>UseCase`, file `<action>-<entity>.use-case.ts`, a single `execute(...)`.
   - Inject the repository with `@Inject(<ENTITY>_REPOSITORY)`. Throw Nest HTTP exceptions (`NotFoundException`, `BadRequestException`) for expected failures, as `GetProductByIdUseCase` does.
3. **Database** — `src/infrastructure/database/`
   - `schemas/<entity>.schema.ts` → `<Entity>Document`.
   - `mappers/<entity>.mapper.ts` → `static toDomain(doc)` (and `toPersistence` if needed). Static methods only.
   - `repositories/mongo-<entity>.repository.ts` → `Mongo<Entity>Repository implements I<Entity>Repository`, maps every result through the mapper.
4. **HTTP** — `src/infrastructure/http/<domain>/`
   - `dto/<entity>.dto.ts` with `class-validator` decorators and `@ApiProperty` for Swagger.
   - Controller: parse the request, call one use case, return the result. No business logic. `@ApiTags`, `@ApiBearerAuth()` + `@UseGuards(JwtAuthGuard)` on protected routes, as in the user and cart controllers. Get the caller with `@CurrentUserEmail()`; a route that changes a resource must check the caller owns it (see `assertAccountOwner`).
   - Module: `MongooseModule.forFeature`, `{ provide: <ENTITY>_REPOSITORY, useClass: Mongo<Entity>Repository }`, every use case in `providers`, and `exports` for what other modules need.
5. **Wire** — import the module in `src/route/app/app.module.ts`.
6. **Tests** — `__tests__/<name>.spec.ts` next to the code. Use cases get unit specs with a mocked repository object (no `Test.createTestingModule`, no Mongo); mappers and entity logic get plain specs. Patterns: `.claude/references/testing-guide.md`.
7. **Docs** — add the route to the API table in `CLAUDE.md` and any new env var to `.env.example`.

## Constraints

- Secrets and URIs come from `ConfigService`/env, never literals.
- Never return a user's `password`; use `toPublicProfile()`.
- Comments only for what the code cannot say.

## Validate

Run the `quality-gates` skill, then smoke the route in Swagger at `http://localhost:3000/api/docs` if the app can start.
