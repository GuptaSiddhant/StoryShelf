# AGENTS.md

Guidance for AI coding agents (and humans) working in the StoryShelf monorepo.

## What StoryShelf Is

A self-hosted visual testing platform for Storybook. Self-hosted Chromatic alternative. See `docs/architecture.md` for the full architecture.

## Toolchain

- **Package manager: nub/nubx** — not npm/yarn/pnpm. Lockfile is `nub.lock`.
  `nubx` is the wrapper that puts `~/.nub/bin` on PATH; if bare `node`/`npx` fails
  with "command not found", prefix commands with `export PATH="$HOME/.nub/bin:$PATH"`.
- **Task orchestration: turbo.** Root scripts (`turbo build|lint|test|fmt`) fan out per package.
- **Bundler: tsdown**, configured per-package via the `"tsdown-entry"` map in each `package.json`.
- **Tests: vitest**, colocated as `*.test.ts` next to sources.
- **Lint/format: oxlint (+ tsgolint type-aware) and oxfmt**, config at `.oxlintrc.json` / `.oxfmtrc.json`.

## Commands

```sh
export PATH="$HOME/.nub/bin:$PATH"   # once per shell

nub run serve          # dev server from TS source, hot-restarts on any repo change (watch)
nubx turbo verify --force                          # full verify (build + lint + test)
nubx turbo verify --filter='@storyshelf/core' --force   # one package + deps

# Per-package (from packages/<name>/):
nub run lint        # oxlint --type-aware
nub run build       # tsdown -> dist/
nub run test        # vitest (hermetic; no browser)
nub run test:integration   # gated browser suite (Playwright + apps/storybook-fixture)
nubx tsc --noEmit -p tsconfig.json   # typecheck

# Website (from website/):
nub run start       # serve the built docs site (astro preview; requires a prior build)
nub run dev         # astro dev server (hot reload)
nub run build       # generate openapi.json (prebuild) + build the docs site
```

## Layout

```
StoryShelf/
  packages/
    core/           @storyshelf/core           -- Hono router, adapter interfaces, models, capture pipeline, diff, retention
    db-sqlite/      @storyshelf/db-sqlite      -- SQLite database adapter (better-sqlite3 + Drizzle)
    db-turso/       @storyshelf/db-turso       -- Turso/libSQL database adapter (@libsql/client + Drizzle)
    storage-local/  @storyshelf/storage-local  -- Local filesystem storage adapter
    storage-s3/     @storyshelf/storage-s3     -- S3-compatible storage adapter (S3, R2, MinIO)
    auth-oauth/     @storyshelf/auth-oauth     -- OAuth/OIDC auth adapter
    auth-password/  @storyshelf/auth-password  -- Shared-password auth adapter
    cli/            @storyshelf/cli            -- CLI client (commander; upload/init/create/server/retry/purge, no Playwright)
    runner-playwright/ @storyshelf/runner-playwright -- pure Playwright CaptureRenderer (server-side render; core orchestrator owns capture)
  apps/
    dev-server/     dev-server      -- Local dev server, runs from TS source via `nub run serve` (no build; Playwright capture + optional shared-password auth)
    storybook-fixture/ storybook-fixture      -- Minimal deterministic Storybook (capture fixture + demo; committed storybook-static/)
  website/                    -- Public docs & marketing site (Astro Starlight)
  examples/
    fly-app/                  -- fly.io deployment demo
  docs/
    architecture.md       -- Full architecture document
    testing.md            -- Testing strategy (unit/adapter/integration/gated-browser)
    website.md            -- Public website, docs & examples plan
    adr/                  -- Architecture Decision Records
```

## Architecture in five sentences

1. Consumers call `createShelfRouter({ database, storage, capture, ... })` -- every concern is an independent adapter interface.
2. Models use **constructor injection** (not AsyncLocalStorage) -- `new BuildsModel(db, storage)`.
3. **Capture is server-side** -- the CLI uploads the built Storybook; the server renders stories with Playwright asynchronously (no repo cloning). Baselines are **per-branch with fallback to the default branch**.
4. Diffs use **pixelmatch** -- configurable thresholds, overlay images stored on disk. Builds are transient and purged; baselines are permanent.
5. The web UI is **server-rendered JSX + HTMX** -- the build review page is the core page, not admin forms.

## Conventions

- **IDs:** ULIDs everywhere (sortable, collision-resistant, URL-safe).
- **Timestamps:** ISO-8601 strings in the database.
- **Commits:** conventional commits (`feat:`, `fix:`).
- **URLs:** type-safe URL builder using `linkRoute()` pattern from StoryBooker.
- **Forms:** HTMX with `hx-post` and `HX-Redirect` header for navigation after POST.
- **API prefix:** all JSON endpoints under `/api/v1`. HTML pages at `/`.
- **Tests:** every model, every router, every adapter must have tests (target 100% coverage). `nub run test` is hermetic (no browser); the capture pipeline is covered by a gated `test:integration` suite — see `docs/testing.md`.
- **No AsyncLocalStorage for models.** Use constructor injection. The store is for router handlers only.
- **Logging:** pino baked into core via `createShelfLogger()`. Always structured objects, never interpolate into the message (`logger.info({ buildId }, "msg")`); attach errors as an `err` child (`logger.error({ err }, "msg")`); derive scoped children for background work (`logger.child({ buildId })`). Hosted observability (Sentry/PostHog/Datadog/GCP/OTEL) are optional pino `transports`, not separate loggers. See ADR 0014.
- **UI:** server-rendered `hono/jsx` + HTMX + `hono/css`. Fixed UI with a `ui` brand config (logo/theme); header + sidebar layout; system theme with manual override; no client framework and no UI adapter — custom UIs consume `/api/v1`. HTMX is vendored locally; the review page uses a small vanilla-JS layer (theme toggle, keyboard review).

## Database options

- **SQLite** (default, self-hosted): `@storyshelf/db-sqlite` — better-sqlite3 + Drizzle ORM. Zero config. WAL mode.
- **Turso** (serverless/cloud): `@storyshelf/db-turso` — @libsql/client + Drizzle ORM. Same schema, same queries, different driver. Works on Vercel, Cloudflare Workers, Lambda.

## Storage options

- **Local filesystem** (default): `@storyshelf/storage-local` — reads/writes to `--data-dir`. One `docker run` to self-host.
- **S3-compatible** (cloud): `@storyshelf/storage-s3` — works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces. Same adapter interface, different implementation.

## Lint rules that bite (oxlint, type-aware)

- `TS4111`: dot access on index signatures forbidden -- use `obj["key"]` on `Record<string, unknown>`.
- Complexity ≤ 20 per function, max-statements ≤ 10 -- split into small helpers.
- `require-unicode-regexp`: every regex needs the `u` flag.
- `unicorn/no-array-sort` → use `toSorted`.
- `unicorn/no-array-callback-reference` → wrap callbacks as arrows.
- `unicorn/consistent-function-scoping`: hoist pure helpers out of closures.
- JSX `<script>` content must go through `dangerouslySetInnerHTML={{ __html }}`.

## Key ADRs (read these before modifying architecture)

`docs/architecture.md` is the canonical current-state spec (entity model, interfaces, workflow). ADRs record decisions and rationale, and reference `architecture.md` rather than duplicating schemas or interfaces.

| ADR | Title |
|-----|-------|
| 0001 | Adapter Composition Pattern (constructor injection, not AsyncLocalStorage) |
| 0002 | SQLite + Turso for Database (Drizzle ORM, same schema both drivers) |
| 0003 | Server-Side Capture (upload Storybook, render asynchronously) |
| 0004 | Pixel Diff Engine (pixelmatch + pngjs) |
| 0005 | Storybook-Only for v1 (Ladle/Histoire deferred to v2) |
| 0006 | Storage Adapter (local filesystem + S3-compatible) |
| 0007 | Rewrite from Scratch (extract patterns from StoryBooker, not code) |
| 0008 | Auth as Pluggable Adapter (OAuth/OIDC, shared password, or none) |
| 0009 | Per-Branch Baselines with Fallback + Retention & Purge |
| 0010 | Git Provider Merge Gate (status checks now, GitHub App later) |
| 0011 | Project Identity & Published Storybook (project = Storybook, public access) |
| 0012 | Fixed Server-Rendered UI (header + sidebar, system theme, three-up diff) |
| 0013 | Build Labels (project-defined types, search + link templates + stable URLs) |
| 0014 | Pino as Core Logger (structured logs, transports via factory, request tracing) |
| 0015 | Pure Capture Renderer Adapter (capture adapters render only; server orchestrator owns loading/extraction/persistence) |

## Parallel Development with Worktrees

For parallel agent development on multiple tasks, use the **`opencode-worktree` plugin** (`ocx add kdco/worktree --from https://registry.kdco.dev`). Config at `.opencode/worktree.jsonc`.

### Creating a Worktree

```sh
# From main worktree (manager session):
worktree_create:
  branch: "task/P1-1-indexes"
  baseBranch: "main"
```

This auto-creates the worktree at `~/.local/share/opencode/worktree/<project-id>/task/P1-1-indexes/`, runs `nub ci` via `postCreate` hook, and opens a new terminal with `opencode` running.

### Per-Worktree Bootstrap

```sh
export PATH="$HOME/.nub/bin:$PATH"
nub ci                    # install deps (runs automatically via hook)
nubx turbo verify --filter='@storyshelf/core' --force  # verify baseline
```

### Worktree Rules

1. **`docs/TASKS.md` is manager-only** — only the main worktree edits status table (`Not Started → In Progress → Done`). Task worktrees only touch their `Files to Modify`.
2. **`nub.lock` is per-worktree** — never run `nub` installs concurrently in same tree.
3. **File ownership** — each task branch only modifies files listed in its `Files to Modify` in `docs/TASKS.md`. Check before editing.

### Wave Assignment (file-disjoint = safe to parallel)

| Wave | Tasks | Concurrent | Notes |
|------|-------|------------|-------|
| 1 | P1-1 + P1-2 | 2 | Schema/migrations + middleware/token — 0 file overlap |
| 2 | P2-3 + P2-4 + P3-2 | 3 | New test files + turbo.json — 0 overlap |
| 3 | P2-1 + P2-2 + P3-1 | 3 | Config + webhook + queue — serialized on `adapters/` |
| 4 | P3-3 + P4-* | as needed | Comment validation + future tasks |

### Finishing a Task

1. **In worktree:** verify, commit, push branch
2. **Call `worktree_delete("P1-1 complete")`** — auto-commits + removes worktree
3. **In main worktree:** squash-merge into `main`:

```sh
# From main worktree:
git merge --squash task/P1-1-indexes
git commit -m "feat(p1-1): add query performance indexes

- Add Drizzle index definitions for snapshots, comments, builds, baselines
- Add migrations for db-sqlite and db-turso adapters
- All tests pass"
git branch -d task/P1-1-indexes
```

4. **Update `docs/TASKS.md`** — flip status to `Done`, add commit hash

### Squash Merge Convention

All task branches must be **squash-merged** into `main` — never fast-forward or regular merge. This keeps `git log --oneline` clean and each task = one commit.

Format:
```
feat(<task-id>): <short description>

- Bullet point summary of changes
- Second bullet point
```

Example: `feat(p1-1): add query performance indexes`

### Manual Worktree (without plugin)

```sh
git worktree add ../StoryShelf-<task-id> -b task/<task-id> main
cd ../StoryShelf-<task-id>
export PATH="$HOME/.nub/bin:$PATH"
nub ci
nubx turbo verify --filter='@storyshelf/core' --force
# ... work ...
# cleanup:
git worktree remove ../StoryShelf-<task-id>
```
