# Copilot Instructions

## PR Workflow

When creating a PR that addresses a GitHub issue:

1. **Link to the issue**: Include `Closes #<number>` in the PR body so the issue auto-closes on merge.
2. **Verify CI passes**: After pushing and creating the PR, run `gh pr checks <pr-number> --watch` to wait for CI. If checks fail:
   - View logs: `gh run view <run-id> --log-failed`
   - Fix the issues locally
   - Push fixes to the branch
   - Repeat until CI is green

## Project Conventions

- **Branching model**: `dev` → `beta` → `main`. Push freely to `dev`; PRs required for `beta` and `main`.
- **Commits**: Use conventional commits (`feat:`, `fix:`, `chore:`, etc.) — release-please parses them for versioning.
- **Package manager**: `pnpm` is not on PATH. Always use `npx pnpm` (e.g. `npx pnpm test`, `npx pnpm build`).
