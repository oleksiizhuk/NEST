---
name: pr
description: Prepare and create a pull request for this NestJS project.
---

# Pull Request Workflow

## Step 1: Verify changes

```bash
git status
git diff HEAD
git log --oneline -5
```

## Step 2: Check quality gates first

Run `/quality-gates` before creating a PR.

## Step 3: Branch naming

```
feature/<short-description>
fix/<short-description>
refactor/<short-description>
```

Example: `feature/email-clean-architecture`, `fix/cart-price-calculation`

## Step 4: Commit

```bash
git add <specific-files>
git commit -m "<type>: <description>"
```

Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`

Examples:
```
feat: add create-shopping-cart use case
fix: correct cart price calculation in domain entity
refactor: migrate product module to clean architecture
test: add unit tests for login use case
```

## Step 5: Ask before pushing

**Before any `git push`, always ask the user:**

> "Запушить ветку `<branch-name>` на GitHub?"

Wait for explicit confirmation before running `git push` or `gh pr create`.

## Step 6: Push & create PR (only after confirmation)

```bash
git push -u origin <branch-name>
gh pr create --title "<type>: <description>" --body "$(cat <<'EOF'
## Summary
-

## Changes
-

## Test plan
- [ ] npm test passes
- [ ] npm run build passes
- [ ] Manual smoke test via Swagger /api/docs
EOF
)"
```

## Notes

- Never push directly to `master`
- Always ask before pushing — even if the user says "create a PR", confirm the push first
- Always run `npm run build` before PR — TypeScript must compile cleanly
- Swagger docs at `/api/docs` for manual verification