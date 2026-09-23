---
name: quality-gates
description: Run all quality checks — type check, lint, tests with coverage, build — and report per gate. Use for "прогони проверки", "run the gates", before a commit or PR. Not for reviewing logic (review).
---

# Quality Gates

Run all four even when an early one fails, so the caller sees the full picture in one pass. Fix only when the caller asked for fixes.

The husky hooks run a subset: `pre-commit` → `npm run lint`, `pre-push` → lint + `npm run test:cov`. Types and build are only checked here and on Vercel, so a green push can still fail the deploy.

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
npm run test:cov
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
✅ test:cov      — all passing
✅ build         — compiled successfully
```

Report a per-gate pass/fail table, then the trimmed error lines and root cause for each failure. `npm run lint` runs with `--fix` and may rewrite files — mention any it touched.

→ Ready for the `commit` / `pr` skills.