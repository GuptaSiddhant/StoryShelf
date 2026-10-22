# AGENTS.md

Guidance for AI coding agents (and humans) working in the StoryShelf monorepo.

## What StoryShelf Is

A self-hosted visual testing platform for Storybook. Self-hosted Chromatic alternative. See `docs/architecture.md` for the full architecture.

## Toolchain

- **Package manager: nub/nubx** — not npm/yarn/pnpm. Lockfile is `nub.lock`.
  `nubx` is the wrapper that puts `~/.nub/bin` on PATH; if bare `node`/`npx` fails
  with "command not found", prefix commands with `export PATH="$HOME/.nub/bin:$PATH"`.
- **Task orchestration: turbo.** Root scripts (`turbo build|lint|test|fmt`) fan out per package.
- **Bundler: tsdown for libs, rolldown for apps.** Each package's `exports` map carries `{ source: ./src/..., default: ./dist/... }`; `config/tsdown.ts` (`libConfig`/`cliConfig`) derives `dist/` for publishable packages, `apps/fly-app/rolldown.config.ts` bundles deployables. See `docs/repo-structure.md`.
- **Tests: vitest**, colocated as `*.test.ts` next to sources (`*.integration.test.ts` for the HTTP-level suite; `RUN_INTEGRATION=1` gates the real-browser suite).
- **Lint/format: oxlint (+ tsgolint type-aware) and oxfmt**, config at `.oxlintrc.json` / `.oxfmtrc.json`.

## Commands

```sh
export PATH="$HOME/.nub/bin:$PATH"   # once per shell

nub run serve          # dev server from TS source, hot-restarts on any repo change (watch)
nub run hook:install   # one-time per clone: enable .githooks (pre-commit oxfmt/oxlint + conventional-commit gate)
nubx turbo verify --force                          # full verify (build + lint + test)
nubx turbo verify --filter='@storyshelf/core' --force   # one package + deps

# Per-package (from packages/<name>/):
nub run lint        # oxlint --type-aware
nub run build       # tsdown -> dist/
nub run test        # vitest (hermetic; no browser)
nub run test:integration   # gated browser suite (Playwright + fixtures/storybook-8; override with FIXTURE_DIR=fixtures/storybook-9)
nubx tsc --noEmit -p tsconfig.json   # typecheck

# Website (from apps/website/):
nub run start       # serve the built docs site (astro preview; requires a prior build)
nub run dev         # astro dev server (hot reload)
nub run build       # generate openapi.json (prebuild) + build the docs site

# Fixtures (independent pnpm installs, not nub workspaces):
# cd fixtures/storybook-8 && pnpm install && pnpm run build-storybook  # SB 8.6 (default, :6008)
# cd fixtures/storybook-9 && pnpm install && pnpm run build-storybook  # SB 9 (:6009)
# cd fixtures/storybook-10 && pnpm install && pnpm run build-storybook # SB 10 ESM + CSF-Next (:6010)
# All fixtures ignored for storybook-static (built on demand, not committed)
```

## Layout

See `docs/repo-structure.md` for the annotated map (workspaces vs fixtures, bundler rule, public import surface, schema layout). Summary:

```
StoryShelf/
  packages/
    core/           @storyshelf/core           -- Adapter interfaces (capture targets: `adapters/capture-target*.ts`), models (incl. the public-origin resolver, `site_settings` and build-level review: `BuildReviewModel`, pure `deriveReviewStatus`), capture pipeline, publishing (`capture/publish/`: capped extraction, acceptance rule, `publish` job handler), Storybook catalog (`capture/catalog/`: index parsing, `build_components` rows, `catalog.json`, lazy loader), the database job queue (`capture/db-queue/`) and its consumer (`capture/consumer/`), forked capture (`capture/forked/`: the parent-side handler and `runCaptureChild`), diff, retention (no HTTP)
    app/            @storyshelf/app         -- Hono app, API routes, server-rendered UI over core (see ADR 0001)
    db-sqlite/      @storyshelf/db-sqlite      -- SQLite database adapters (node:sqlite default + turso/better-sqlite3/bun-sqlite/d1 presets via subpaths)
    db-postgres/    @storyshelf/db-postgres     -- Postgres database adapters (postgres.js default + pg/neon/neon-http/vercel/pglite presets via subpaths)
    db-mysql/       @storyshelf/db-mysql        -- MySQL/MariaDB database adapters (mysql2 default + planetscale/tidb presets via subpaths)
    storage-local/  @storyshelf/storage-local  -- Local filesystem storage adapter
    storage-s3/     @storyshelf/storage-s3     -- S3-compatible storage adapter (S3, R2, MinIO)
    storage-azure/  @storyshelf/storage-azure  -- Azure Blob Storage adapter
    storage-gcs/    @storyshelf/storage-gcs    -- Google Cloud Storage adapter
    image/          @storyshelf/image           -- Pixel diff, overlay rendering and thumbnails on a worker pool; pngjs default codec, optional sharp (leaf package, see ADR 0008)
    auth/           @storyshelf/auth            -- Better Auth engine (local accounts, OAuth/OIDC, SSO, passkeys; see ADR 0011)
    cli/            storyshelf              -- CLI client (commander; upload/init/create/server/retry/purge, no Playwright)
    runner-playwright/ @storyshelf/runner-playwright -- pure Playwright CaptureRenderer (server-side render; core orchestrator owns capture; `browsers` option = local targets)
    runner-puppeteer/  @storyshelf/runner-puppeteer  -- Puppeteer CaptureRunner (Chromium via chrome-headless-shell, smaller image; `browsers` option, needs an `executablePath`)
    affected/       @storyshelf/affected        -- Affected capture: dependency-graph tracing that selects the stories impacted by a change
    design-figma/   @storyshelf/design-figma    -- Figma design provider: link validation, file metadata, rendered previews (optional; see ADR 0018)
    notify-chat/    @storyshelf/notify-chat     -- Chat notification providers (Slack and Teams incoming webhooks)
    notify-email/   @storyshelf/notify-email    -- Email notification transport (SMTP, Mailpit, log, HTTP APIs)
    notify-git/     @storyshelf/notify-git      -- Git notification providers (`state` delivery): GitHub and GitLab commit statuses and PR/MR comments, plus a `git-log` provider (zero dependencies, `httpJson`; see ADR 0014)
    observability/  @storyshelf/observability  -- OTEL tracing/metrics/log-correlation (single OTEL owner; see ADR 0015)
    ai/             @storyshelf/ai              -- AI insights engine on the Vercel AI SDK (build triage + project health; see ADR 0016)
    mcp/            @storyshelf/mcp             -- MCP server for AI agents (stdio + Streamable HTTP; thin client over /api/v1, read + comment only; see ADR 0017)
  apps/
    dev-server/     dev-server      -- Local dev server, runs from TS source via `nub run serve` (no build; Playwright capture + optional shared-password auth)
    website/        website         -- Public docs & marketing site (Astro Starlight)
    fly-app/        fly-app         -- Fly demo (local adapters, workspace deps, multi-stage cached Dockerfile; deploys on tag via fly.yml)
  fixtures/
    storybook-8/    storybook-fixture -- SB 8.6 Vite React (default; Button, Themed and Accessibility stories; own pnpm install)
    storybook-9/    storybook-fixture -- SB 9 Vite React
    storybook-10/   storybook-fixture -- SB 10 ESM + CSF-Next (filters subtype:'test')
  docs/
    architecture.md       -- Full architecture document
    testing.md            -- Testing strategy (unit/adapter/integration/gated-browser)
    website.md            -- Public website, docs & examples plan
    adr/                  -- Architecture Decision Records
  .agents/skills/   -- Agent skills (ui-building-blocks, adapter-layout); tool-neutral SKILL.md format, symlinked as .claude/skills
```

**Terminology note:** When working in this repo:

- `"app"` / `"packages/app"` → the **product UI** (Hono JSX + HTMX server, `/api/v1` endpoints, build-review diff pages). Commands: `nub run build`, `nub run lint`, test in `packages/app/`.
- `"website"` / `"apps/website"` → the **public docs site** (Astro Starlight Markdown docs, SEO, SRI hashes). Commands: `nub run --filter website build`, `nub run --filter website start`. Docs lives in `apps/website/src/content/docs/`.

This distinction matters for:

- Which package to modify (UI vs docs)
- Which test suite to run (vitest in `packages/` vs hermetic `nub run test` at repo root)
- Which build command to use
- Directory paths when editing files

## Architecture in five sentences

1. Consumers call `createShelfApp({ database, storage, testing, ... })` -- every concern is an independent adapter interface.
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
- **Route classification:** every route the app registers is classified `hosting | testing | review | both` (ADR 0006, decision 8) in `app/src/routes/` (`api-routes.ts` for `/api/v1`, `page-routes.ts` for pages/auth/Storybook; key `"METHOD /hono-pattern"`, exactly as `app.routes` reports it; the OpenAPI document marks each operation `x-storyshelf-class`). New route ⇒ classify it there; `routes/classification.test.ts` fails on unclassified routes and on stale entries. A new `app.all(...)` handler must be listed too (unlisted `ALL` entries count as middleware). `requireTesting` (`app/src/middleware/require-testing.ts`) answers 404 for every `testing` route when `options.testing` is absent (`Store.testing`, `testingEnabled()`); a test boots without `testing` and checks every class.
- **Capture targets (ADR 0007):** a project's `browser`/`browsers`, a snapshot's `browser` and every baseline key hold a `CaptureTarget` (an engine, or `<engine>@<name>`), never a bare `BrowserName` (that is the type of a rendering engine only). Split a target with `parseTarget`/`engineOf` (`core/adapters/capture-target.ts`), validate with `isCaptureTarget`; the render input is `target`, not `browser`. A runner publishes `metadata.targets` (`RunnerTarget`: `ready`/`unavailable` + reason) from its `browsers` option via `createTargetOffers`; check availability with `refusalFor`/`offeredTargets` (`core/capture`), and in the app through `runnerTargets()`/`assertTargetsSelectable()` (`app/src/targets.ts`) on every save of a project's browsers. A launch failure is a `TargetLaunchError` (not isolated, not retried as a story crash).
- **Public origin (ADR 0007):** never read `config.publicBaseUrl` or a request's `Host` to build an absolute link. Background code asks `createPublicOriginResolver(...)` (`core/models`; the app holds it as `Store.publicOrigin`/`runtime.publicOrigin`, jobs get a `publicOrigin: () => Promise<string | undefined>`); with no origin a status has no link (`urls: null` in `statusesForBuild`) and no comment. Only request-bound interactive routes (OAuth redirect URI, the OIDC helper) may fall back to the request's own origin. The stored value lives in `site_settings` and is written only by the site-admin CSRF routes in `routers/admin-public-origin.ts`.
- **Hosting only:** no `testing` option ⇒ no capture, compare or baselines (ADR 0006). Gate by route class, never by ad-hoc `if`; UI that links to a `testing` route must check `testingEnabled()` (nav, settings tabs and the build table already do). `assertServerless` (core) refuses `testing.runner` on AWS Lambda and warns on Vercel/Netlify (`STORYSHELF_ALLOW_SERVERLESS=1` overrides); database adapters that cannot back `testing` set `metadata.supportsTesting: false` (D1).
- **Build state on git channels:** never post a status from a call site. A build's statuses and PR comment are the pure `statusesForBuild` (`core/adapters/notifier/build-state.ts`); every transition calls `BuildStatePublisher.request(buildId)` (`core/capture/build-state/`; in the app `requestBuildState` in `git-status.ts`, `setupBuildState` in `build-state-setup.ts`), which queues one `notify` job per git channel (own queue and consumer in `jobs-setup.ts`; inline when there is no consumer). A new status is a new case in the function, not a new caller. The `notify` handler reads the build when it runs and throws on a refused write so the consumer retries it. See ADR 0014, decisions 5 to 7.
- **Tests:** every model, every router, every adapter must have tests (target 100% coverage). `nub run test` is hermetic (no browser); the capture pipeline is covered by a gated `test:integration` suite — see `docs/testing.md`.
- **No AsyncLocalStorage for models.** Use constructor injection. The store is for router handlers only.
- **Signed Storybook URLs (ADR 0007, decision 5):** the one unauthenticated read of a private build is `GET /s/:token/*` (`app/src/routers/signed-storybook.ts`, class `testing`). Tokens come only from `signStorybookToken`/`verifyStorybookToken` (`core/utils`, key derived from `config.secret` with a fixed context; `previousSecret` verifies, never signs) and are minted only by `storybookUrlSource` (`core/capture/storybook-urls.ts`) for `reach: "url"` targets when a render pass starts. Never put a token in a log line, error text, span attribute or `Referer`: `redactSecrets` scrubs `/s/<token>`; route code answers one identical `404` for every refusal and `Cache-Control: private, no-store`. Do not add routes under `/s/`, and do not widen what a token grants (one project, one build, static files).
- **Review (ADR 0013):** `projects.review_enabled` (default true) and `review_approvals` (default 1) are the only switches; there is no `ShelfOptions` field. Build-level verdicts live in `build_reviews` (`BuildReviewModel`; a reviewer's newest row counts). The status they give a build is the pure `deriveReviewStatus` (`core/models/build-review-status.ts`), used only with `testing` off and review on; with `testing` on the snapshot rollup decides. `publishVerdict` accepts a non-default build when review is off. Every route that moves a build to `approved`/`rejected` ends in `announceBuildStatus` (`routers/builds.handlers.ts`), never a hand-written webhook; a verdict write always calls `requestBuildState`. A `review` route of a project with review off answers 404 through the class gate `requireReview` (`app/src/middleware/require-review.ts`, mounted after `authGate`; it reads the switch from the database on every request and only answers a caller who may view the project): never check the switch in a handler, classify the route `review` (`routes/gating.integration.test.ts` boots a review-off project and checks every `review` route, API and page). The review switch form (`POST /projects/:slug/settings/review`) is classed `hosting` on purpose: it must stay reachable to turn review back on. Browser forms cannot post JSON to `/api/v1` (415), so the review UI posts to page routes (`routers/review-forms.ts`, class `review`) that call the same handlers; a new review form needs both. The build page composes `VerdictCard`, `ChangesetCard` and `CommentsCard` (`pages/review-*.tsx`) from `loadReviewSection` (`routers/review-section.handlers.ts`); the changeset is the pure `computeChangeset`/`changesetOf` (`core/models/changeset.ts`). Events `review:requested` (`afterPublish` hook; default-on for approvers and admins in `notify.ts`), `review:comment` (build and story comments; snapshot comments keep `comment:created`) and `review:verdict` go through `announceReview` (`app/src/review-events.ts`). Turning review off runs `runSwitchOffPass` (`routers/review-switch-off.ts`); the retention rule for pending builds is `retention/pending.ts`. The MCP server exposes comments, never verdicts. Comments anchor to exactly one of build, story (`storyId`) or snapshot. The git flags come from `buildStateFlags(testing, project)` (`app/src/build-state-flags.ts`), never a literal.
- **Publishing is independent of capture:** zips up to `maxInlineUnzipSize` (default 50 MB, stream-counted, never `Content-Length`) are extracted inline; larger ones are `publish` jobs on the database queue run by the app's job consumer (see below; not wired on serverless hosts, where the zip route answers 413 pointing to `/dedup` → `/content` → `/manifest`). Extraction is capped by `maxZipEntries` / `maxUnzippedBytes`. Every publish route ends in `PublishCompleter.complete` (`publishVerdict` is the one acceptance rule; `afterPublish` hooks hang off it) — never set a build status from a publish route directly.
- **One job queue, one consumer (ADR 0006):** `app/src/jobs-setup.ts` wires the shared database queue (`job-queue.ts`, built lazily), a handler per job kind (`capture` in `capture-setup.ts`, `publish` in `publish-setup.ts`) and ONE `createCaptureConsumer` for all kinds. It starts once adapters are ready (`boot-tasks.ts`, and `lifecycle.setup()`), and `teardown()` drains it (jobs in flight finish; the forked child is stopped after). Uploads enqueue through `getStore().enqueueCapture`; there is no in-memory queue, no boot sweep of `capturing` builds and no stall handler: lease expiry and redelivery recover work (`DatabaseCaptureQueueOptions.onExhausted` fails the build of a job whose last attempt lost its lease). `testing.retries` is the one retry limit (queue `retries`, consumer `maxRetries`, forked child). `testing.queue` replaces the database queue for captures (a `PollableCaptureQueue`; consumed here when there is a `runner`). New job kind ⇒ a handler registered in `jobs-setup.ts` and, if it can lose its lease, an `exhausted` hook. Forked capture (`testing.workerEntry`): the parent consumes and pushes (`createForkedCaptureHandler`, protocol `run|cancel` / `progress|done|failed`); the child never reads the queue and inserts shard jobs itself.
- **Library, component and build pages render from the catalog** (`catalogOf()` in `app/src/store.ts`), with `testing` on or off; snapshot data is layered on only when `testingEnabled()` (the instance has `enqueueCapture`). Never read `index.json` directly in a page: use the catalog loader. Missing story parameters (design links, modes) are not an error. The component preview is click-to-load in a sandbox without `allow-same-origin` (`PreviewEmbed`); published files get `Access-Control-Allow-Origin: *` only for builds viewable without credentials (`previewCorsHeaders`).
- **Turbo cache inputs:** CI restores turbo's task cache, so a task's hash must cover everything it reads. Files shared by all packages live in `globalDependencies` (`config/**`, `nub.jsonc`); `build` ignores tests, `README.md` and `LICENSE` so a test-only edit does not rebuild dependents; `lint` and `fmt` add their root config. A test that reads a file outside its package must list it in that package's `turbo.json` (`extends: ["//"]`, `inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/<path>"]`; see `packages/app/turbo.json`), or an edit to that file keeps a stale cached pass. Check a change with `nubx turbo run build lint test --dry=json` before and after. Live-cloud workflows use `--force` on purpose.
- **Temp files:** for scratch work, prefer a repo-local `.tmp/` directory over `/tmp` (permissions). `.tmp` is gitignored.
- **Logging:** pino baked into core via `createShelfLogger()`. Always structured objects, never interpolate into the message (`logger.info({ buildId }, "msg")`); attach errors as an `err` child (`logger.error({ err }, "msg")`); derive scoped children for background work (`logger.child({ buildId })`). Runtime loggers are host-owned: the app binds scoped children onto adapters via the optional `Adapter.setLogger` (factories accept `options.logger` only as an explicit override and must never create their own loggers). Hosted observability (Sentry/PostHog/Datadog/GCP/OTEL) are optional pino `transports`, not separate loggers. See ADR 0015.
- **HTTP:** outbound calls go through the shared helper (`@storyshelf/core/utils`: `httpJson`/`HttpError`) — timeout plus retry with `Retry-After` built in. Never hand-roll fetch error handling per package, and never add client libraries (`ky`/`ofetch`) — see ADR 0001.
- **Remote browsers (ADR 0007):** a `browsers` entry that is a remote service (`defineRemote` in `core/src/adapters/remote-browser.ts`; presets live in the runners' `./remote` subpaths, plain configuration, no vendor SDKs) expands to `<engine>@<name>` targets with their own baselines. Their environment is measured inside the browser (`inPageProbe`/`remoteEnvironment`), never with `detectCaptureEnvironment` (host `process.platform`, `fc-list`); page concurrency is the service's `sessions` through the process-wide `sessionGateFor(target)`; connecting goes through `retryConnect` and fails as a `TargetLaunchError` (`transient` when the service may come back, so the target stays offered) with the endpoint, query values and header values scrubbed (`scrubConnection`). Never put an endpoint or header in a log or error: it carries credentials. The self-hosted farm guide pins `playwright@<version>`; `runner-playwright/src/guide.test.ts` fails when it drifts from `playwright-core`.
- **UI:** server-rendered `hono/jsx` + HTMX + `hono/css`. Fixed UI with a `ui` brand config (logo/theme); icon sidebar + slim top bar shell (`ui/shell/`); system theme with manual override; no client framework and no UI adapter — custom UIs consume `/api/v1`. The customer accent is used subtly (derived `color-mix` tokens, never a full-width bar). Icons come from the cached sprite (`<Icon>`, `ui/icons/paths.ts`). HTMX is vendored locally; a small vanilla-JS layer (theme/sidebar/dropdown/toast, review comparison + keyboard) runs once per document — see the `ui-building-blocks` skill (`.agents/skills/`) before touching it.
- **UI building blocks (strict):** pages compose facade components from `app/src/ui/components.tsx` (`Button`, `Tabs`, `Badge`, `Alert`, `EmptyState`, `Stat`, `Field`, `Card`, `PageHeader`, `HStack`, `VStack`, …) — never raw `btn`/`tabs`/`card` classes, never `style="..."` in `pages/`, never direct family imports. Component styles live colocated via `hono/css` imported from `app/src/ui/css.ts` (custom context: readable `ss-<label>-<hash>` names, one `<style id="storyshelf-css">` mounted in `DocumentLayout`): one labeled `css` template per variant composed via `${base}` extension (never `cx` for variants — it drops labels), `&` nesting for pseudo-states, static values only (brand tokens stay CSS vars). Stack layout uses `HStack`/`VStack`, never utility divs. Inline/table/card actions use `size="sm"`. `app/src/ui/consistency.test.ts` is the ratchet — zero tolerance on classes, imports, and inline styles. See the `ui-building-blocks` skill.
- **Primary export first:** in every module, the primary exported item (the factory/router/class readers came for — e.g. `createShelfApp`, `createLocalStorage`, model classes) sits as high as possible: doc header, imports, then the primary export before helpers, secondary types, and internal utilities. Skim-reading rule: the file's purpose must be obvious within the first screen.
- **Module layout (one concern per file):** split a module when it exceeds ~150 lines or holds 3+ distinct concerns. Adapter packages follow per-kind layouts — storage: `types` (Options), `keys` (key join/split), `client` (construction), `lifecycle` (setup/health/teardown), `operations` (buffered CRUD + listing), `streams`, `errors`; runners: `types`, `browser`, `runtime-params`, `pipeline`, `screenshot`, `play`, `a11y`. `index.ts` is a hybrid composition root (factory wiring first, type re-exports at the bottom) — never a logic dump. Keep the package `exports` map frozen: new modules stay internal unless the package owner approves a new subpath. New module ⇒ colocated `<module>.test.ts` (move cases with the code); indirect coverage is allowed only for pure mappers. See the `adapter-layout` skill for templates.
- **Single prod owner per third-party dep:** a runtime dependency lives in exactly one package's `dependencies` (e.g. `pino` and `axe-core` in `@storyshelf/core`); other packages use `devDependencies` for tests and import types through the owner (`@storyshelf/core/logger`), never directly.

## Database options

- **SQLite** (default, self-hosted): `@storyshelf/db-sqlite` — node:sqlite (zero-dependency builtin) + Drizzle ORM. Zero config. WAL mode.
- **SQLite presets** (same package, subpaths): `@storyshelf/db-sqlite/turso` (libSQL serverless: Turso/Vercel/Lambda, optional `@libsql/client` peer), `./better-sqlite3` (native, optional `better-sqlite3` peer), `./bun-sqlite` (Bun-only), `./d1` (Cloudflare D1 binding, no peer). Same schema, same queries, different driver.
- **Postgres presets** (same package, subpaths): `@storyshelf/db-postgres` (postgres.js default) + `./pg` (node-postgres pooler-safe), `./neon`, `./neon-http`, `./vercel`, `./pglite` (embedded WASM). Same schema, same queries, different driver.
- **MySQL presets** (same package, subpaths): `@storyshelf/db-mysql` (mysql2 default, MySQL/MariaDB) + `./planetscale`, `./tidb` (serverless MySQL). Same schema, same queries, different driver.
- Retired packages are logged in `docs/deprecated.md` (run `npm deprecate` per published version when retiring).

## Storage options

- **Local filesystem** (default): `@storyshelf/storage-local` — reads/writes to `--data-dir`. One `docker run` to self-host.
- **S3-compatible** (cloud): `@storyshelf/storage-s3` — works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces. Same adapter interface, different implementation.
- **Azure Blob / Google Cloud Storage**: `@storyshelf/storage-azure`, `@storyshelf/storage-gcs` — same adapter interface for those clouds.

## Lint rules that bite (oxlint, type-aware)

- `TS4111`: dot access on index signatures forbidden -- use `obj["key"]` on `Record<string, unknown>`.
- Complexity ≤ 20 per function, max-statements ≤ 10, max-lines-per-function ≤ 50 -- split into small helpers (no path-based lint exemptions; fix the code, not the config).
- `require-unicode-regexp`: every regex needs the `u` flag.
- `unicorn/no-array-sort` → use `toSorted`.
- `unicorn/no-array-callback-reference` → wrap callbacks as arrows.
- `unicorn/consistent-function-scoping`: hoist pure helpers out of closures.
- JSX `<script>` content must go through `dangerouslySetInnerHTML={{ __html }}`.

## Key ADRs (read these before modifying architecture)

`docs/architecture.md` is the canonical current-state spec (entity model, interfaces, workflow). ADRs record decisions and rationale, and reference `architecture.md` rather than duplicating schemas or interfaces.

| ADR  | Title                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001 | Architecture and Conventions (adapter composition, constructor injection, core/app split, server scaffolding, shared HTTP helper, Storybook-only) |
| 0002 | Database (SQLite default, Postgres/MySQL/Turso presets, Drizzle)                                                                                  |
| 0003 | Storage and Content-Addressed Assets                                                                                                              |
| 0004 | Capture Pipeline (server-side render, pure renderers, `play` and a11y, modes and multi-browser)                                                   |
| 0005 | Capture Performance and Sharding                                                                                                                  |
| 0006 | Testing Option, Hosting-Only Mode and the Database Queue (`testing`, no worker package, `capture_jobs`)                                           |
| 0007 | Remote Browsers and Public Origin (`browsers` list, `<engine>@<name>` targets, signed URLs)                                                       |
| 0008 | Image Diff Engines (pixelmatch, worker pool, optional sharp)                                                                                      |
| 0009 | Baselines, Approval and Retention                                                                                                                 |
| 0010 | Projects, Published Storybook and Labels                                                                                                          |
| 0011 | Authentication and Access (Better Auth engine, roles, OAuth connections)                                                                          |
| 0012 | Server-Rendered UI                                                                                                                                |
| 0013 | UI Review (per-project `review`, build-level verdict, changeset)                                                                                  |
| 0014 | Git Hosts and Notifications (`@storyshelf/notify-git`, durable state delivery)                                                                    |
| 0015 | Observability and Logging (pino, OpenTelemetry)                                                                                                   |
| 0016 | AI Insights                                                                                                                                       |
| 0017 | MCP Server                                                                                                                                        |
| 0018 | Design Providers                                                                                                                                  |

The pre-consolidation ADRs (0001 to 0036) are in `docs/adr/archive/`; `docs/adr/README.md` maps them to the ADRs above.

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

1. **GitHub Issues is the source of truth** — `docs/archive/TASKS.md` is archived (frozen 2026-09-04, issues #1–#25). Manager creates/labels/milestones/assigns issues; agents pick up open issues via `gh issue list --state open`. Task worktrees only touch their issue's `Files to Modify`.
2. **`nub.lock` is per-worktree** — never run `nub` installs concurrently in same tree.
3. **File ownership** — each task branch only modifies files listed in its issue's `Files to Modify`. Check before editing.

### Wave Assignment (file-disjoint = safe to parallel)

| Wave | Tasks              | Concurrent | Notes                                                 |
| ---- | ------------------ | ---------- | ----------------------------------------------------- |
| 1    | P1-1 + P1-2        | 2          | Schema/migrations + middleware/token — 0 file overlap |
| 2    | P2-3 + P2-4 + P3-2 | 3          | New test files + turbo.json — 0 overlap               |
| 3    | P2-1 + P2-2 + P3-1 | 3          | Config + webhook + queue — serialized on `adapters/`  |
| 4    | P3-3 + P4-*        | as needed  | Comment validation + future tasks                     |

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

4. **Close the issue** — comment with commit hash and close (`gh issue close <n> --reason completed`), or `Closes #<n>` in the squash commit. Never edit `docs/archive/TASKS.md` (archived).

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

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
