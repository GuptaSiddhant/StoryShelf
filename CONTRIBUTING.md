# Contributing to StoryShelf

Thanks for helping out. This file covers the toolchain, the local workflow, and how changes get merged. `AGENTS.md` is the long-form reference (architecture, conventions, lint rules) and applies to humans and AI agents alike.

## Toolchain

StoryShelf uses **nub / nubx**, not npm, yarn, or pnpm. The lockfile is `nub.lock`. Tasks are orchestrated by **turbo**; tests run on **vitest**; lint and format use **oxlint** and **oxfmt**.

```sh
export PATH="$HOME/.nub/bin:$PATH"   # once per shell, if `node`/`nubx` is not found
nub ci                               # install dependencies
nub run hook:install                 # one-time per clone: pre-commit oxfmt/oxlint + conventional-commit gate
```

Use `nubx` where you would use `npx` (for example `nubx tsc --noEmit -p tsconfig.json`).

## Verify before you push

```sh
nubx turbo verify --force                               # build + lint + test, whole repo
nubx turbo verify --filter='@storyshelf/core' --force   # one package and its dependencies
```

- `nub run test` is hermetic (no browser). The real-browser suite is gated: `nub run test:integration` (see `docs/testing.md`).
- Every model, router, and adapter needs tests. A new module gets a colocated `<module>.test.ts`.
- Read the ADRs in `docs/adr/` before changing architecture.

## Workflow

1. **Pick or file an issue.** GitHub Issues is the source of truth. For tracked work, use the "Tracked task" template (`.github/ISSUE_TEMPLATE/task.yml`) and list the files the task may touch. Bugs use the bug template.
2. **Work in a branch or git worktree** so parallel tasks stay isolated:

   ```sh
   git worktree add ../StoryShelf-<task-id> -b task/<task-id> main
   cd ../StoryShelf-<task-id>
   nub ci
   ```

   Only touch the files listed in the issue's "Files to Modify". `nub.lock` is per worktree, so never run installs concurrently in the same tree.
3. **Commit with [conventional commits](https://www.conventionalcommits.org/)** (`feat:`, `fix:`, `docs:`, `chore:` …). The pre-commit hook enforces the format.
4. **Open a pull request** against `main`. CI must be green.
5. **Merges are squash merges.** One task is one commit on `main`, titled `feat(<task-id>): <short description>`. Reference the issue with `Closes #<n>`.

## Handling secrets

Never commit credentials. The server `SECRET` (at least 32 characters, for example `openssl rand -hex 32`) signs sessions and encrypts webhook and git-provider secrets at rest. Use throwaway values in tests, fixtures, and docs. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
