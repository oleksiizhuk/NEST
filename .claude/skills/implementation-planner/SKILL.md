---
name: implementation-planner
description: Plan implementation of a new feature following Clean Architecture before writing code.
---

# Implementation Planner

Before writing any code for a new feature, create a plan following the Clean Architecture layers.

## Checklist

### 1. Domain layer — `src/domain/<entity>/`

- [ ] Does the entity exist? If not, create `<entity>.entity.ts` (pure TS class, no imports from NestJS/Mongoose)
- [ ] Does the repository interface exist? If not, create `<entity>.repository.interface.ts` with a DI token
- [ ] Is there domain logic that belongs in the entity (calculations, validations)?

### 2. Application layer — `src/application/<domain>/use-cases/`

- [ ] List all operations needed (one use case per operation)
- [ ] Each use case depends only on domain interfaces (`@Inject(TOKEN)`)
- [ ] No HTTP, no Mongoose, no business logic leaking into controllers

### 3. Infrastructure — `src/infrastructure/`

- [ ] **Schema**: does `database/schemas/<entity>.schema.ts` exist?
- [ ] **Mapper**: does `database/mappers/<entity>.mapper.ts` exist? (`toDomain` static method)
- [ ] **Repository**: does `database/repositories/mongo-<entity>.repository.ts` implement the interface?
- [ ] **Controller**: thin, only HTTP parsing → calls use case → returns result
- [ ] **DTO**: validation decorators for HTTP input (lives in `http/<domain>/dto/`)
- [ ] **Module**: wires `{ provide: TOKEN, useClass: MongoRepo }` + lists all use cases in `providers` and `exports`

### 4. Module wiring

- [ ] Is the new module imported in `app.module.ts`?
- [ ] Are exported providers available to dependent modules?

## Output format

```
Feature: <name>

Domain:
  - Entity: <file> (new/existing)
  - Interface: <file> (new/existing)
  - Domain logic: <description or none>

Use Cases:
  - <ActionEntityUseCase> — <one line description>
  - ...

Infrastructure:
  - Schema: <file>
  - Mapper: <file>
  - Repository: <file>
  - Controller endpoints: <METHOD /path>
  - Module: <file>

Open questions:
  - <anything unclear before starting>
```