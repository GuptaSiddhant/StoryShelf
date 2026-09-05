# StoryShelf — Implementation Plan

Step-by-step build order. Each step is independently reviewable. Decisions made during implementation are recorded in `docs/DECISIONS.md`.

## Phase 0 — Foundation (this step)

1. Root workspace: `package.json` (nub workspaces + catalog), `turbo.json`, `tsconfig.base.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore`.
2. `@storyshelf/core` — the heart. Order within core:
   - `adapters/*` — interface types only (database, storage, capture-runner, auth, status, logger).
   - `models/*` — Drizzle schema + business logic (project, build, snapshot, baseline, member, comment, label, token, webhook).
   - `diff/*` — pixelmatch engine + overlay.
   - `capture/*` — StorySourceAdapter, storybook adapter, serve, pipeline, queue.
   - `retention/*` — purge.
   - `routers/*` + `pages/*` — API + server-rendered UI.
   - `urls.ts`, `store.ts`, `config.ts`, `index.ts`.
3. Verify core typechecks + unit tests pass.

## Phase 1 — Database adapters (parallel)

- `@storyshelf/db-sqlite` — node:sqlite + Drizzle, WAL, migration runner.
- `@storyshelf/db-turso` — @libsql/client + Drizzle, same schema.

## Phase 2 — Storage adapters (parallel)

- `@storyshelf/storage-local` — filesystem read/write/delete/exists/list.
- `@storyshelf/storage-s3` — S3-compatible via AWS SDK v3.

## Phase 3 — Auth adapters (parallel)

- `@storyshelf/auth-oauth` — OIDC authorization-code flow.
- `@storyshelf/auth-password` — shared password + signed session cookie.

## Phase 4 — CLI

- `@storyshelf/cli` — client: `upload`, `retry`, `init`, `create`, `purge` + `server init` (no Playwright). `storyshelf server init` generates a server project with the user's chosen adapters (replaces the former `@storyshelf/node-server` package, per DECISIONS 24).
- `@storyshelf/runner-playwright` — Playwright `CaptureRunner` (server-side capture).

## Phase 5 — Examples, fixtures & website

- `fixtures/storybook-8` — SB 8.6 Vite React (default, 7 stories; own pnpm install, built on demand)
- `fixtures/storybook-9` — SB 9 Vite React
- `fixtures/storybook-10` — SB 10 ESM + CSF-Next
- `fixtures/storybook-11` — SB 11 alpha
- `apps/fly-app` — fly.io deploy (pruned via turbo + nub trick)
- `apps/website/` — Astro Starlight docs + marketing.

## Phase 6 — Verification & commit

- `nub install`, `turbo build`, `turbo lint`, `turbo test`, typecheck per package.
- Fix errors, commit.

## Conventions to honor (from AGENTS.md)

- ULIDs, ISO-8601 timestamps, constructor injection (no AsyncLocalStorage for models), hono/jsx + HTMX (vendored), type-safe `linkRoute()` URLs, `/api/v1` JSON prefix, `*.test.ts` colocated, oxlint type-aware rules (max-statements ≤ 10, complexity ≤ 20, `u` regex flag, `toSorted`).
