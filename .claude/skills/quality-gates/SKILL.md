---
name: quality-gates
description: Run all quality checks before creating a PR — type check, lint, tests, build.
---

# Quality Gates

Run in order. Fix failures before moving to the next step.

## 1. TypeScript — no errors

```bash
npx tsc --noEmit
```

## 2. Lint

```bash
npm run lint
```

## 3. Tests

```bash
npm test
```

Use cases in `src/application/` can be unit-tested without NestJS or MongoDB:

```typescript
const mockRepo: IUserRepository = {
  findAll: jest.fn(),
  findByEmail: jest.fn().mockResolvedValue(user),
  // ...
};
const useCase = new LoginUseCase(mockRepo, jwtGenerator);
```

## 4. Build — must compile clean

```bash
npm run build
```

## All passed?

```
✅ tsc --noEmit  — no errors
✅ lint          — no errors
✅ test          — all passing
✅ build         — compiled successfully
```

→ Ready for `pr` skill.