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
6. **Add a changeset** when the change affects what a published package does: `nub run changeset <patch|minor|major> --message "<entry>"`, then commit the file it creates. Write it like a `CHANGELOG.md` entry. Docs, test and CI changes need none; put the `no-release` label on the pull request so the check passes. Never edit `CHANGELOG.md` or package versions by hand.

## Releases and previews

Packages are released from [Changesets](https://github.com/changesets/changesets)-format files, versioned by our own `scripts/version-packages.mjs` (ADR 0043). All published packages share one version.

- **`next` builds.** Each push to `main` that has pending changesets publishes every package to npm under the `next` dist-tag, versioned `<next version>-next-<short sha>`, for example `npm install @storyshelf/core@next`. A push without a pending changeset publishes nothing, and `latest` is never touched.
- **Stable releases** are cut by pull request, on request. `nub run release:prepare` versions the pending changesets on a `release/v<version>` branch (one version, the `CHANGELOG.md` section, `chore(release): v<version>`); open a pull request from it. Merging it to `main` publishes to `latest` on npm, tags `v<version>`, and creates the GitHub Release. If a publish fails, the next push to `main` retries it, or run the `Release` workflow by hand with that version.
- **Epic-branch previews.** Each push to an `epic/**` branch builds the public packages and publishes commit-based previews through pkg.pr.new, without publishing to npm. For example, `npm install https://pkg.pr.new/GuptaSiddhant/StoryShelf/@storyshelf/core@epic/437-review`, or replace the branch with a commit SHA. Run the CLI preview with `npx https://pkg.pr.new/GuptaSiddhant/StoryShelf/storyshelf@epic/437-review`. pkg.pr.new assigns the preview version when packing, after the build, so CLI-generated projects keep using the repository version for npm dependencies. The [pkg.pr.new GitHub App](https://github.com/apps/pkg-pr-new) must be installed on this repository; preview retention is managed by pkg.pr.new, so use `next` or stable releases for durable dependencies.

## Handling secrets

Never commit credentials. The server `SECRET` (at least 32 characters, for example `openssl rand -hex 32`) signs sessions and encrypts webhook and git-provider secrets at rest. Use throwaway values in tests, fixtures, and docs. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
