---
name: pr
description: Prepare and create a pull request for this NestJS project — gates, branch, commit, push, gh pr create. Use for "открой PR", "create a PR". Merging and checking the deploy afterwards is the deploy skill.
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
feat/<short-description>
fix/<short-description>
refactor/<short-description>
```

Example: `feat/email-clean-architecture`, `fix/cart-price-calculation`

## Step 4: Commit

Use the `commit` skill: Conventional Commits with a scope (`feat(mcp): ...`), diff shown to the user before committing.

## Step 5: Ask before pushing

**Before any `git push`, always ask the user:**

> "Запушить ветку `<branch-name>` на GitHub?"

Wait for explicit confirmation before running `git push` or `gh pr create`. If the user's request already said to push ("запушь", "push and open a PR"), that is the confirmation.

## Step 6: Push & create PR (only after confirmation)

```bash
git -c credential.helper='!gh auth git-credential' push -u origin <branch-name>
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
- Ask before pushing unless this request explicitly asked for the push — "create a PR" alone is not a push request
- End the PR body with the attribution line the session supplies
- Always run `npm run build` before PR — TypeScript must compile cleanly
- Swagger docs at `/api/docs` for manual verification