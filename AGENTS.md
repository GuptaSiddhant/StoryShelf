# AGENTS.md

Guidance for AI agents (and humans) working in the StoryShelf monorepo.

StoryShelf is a self-hosted visual-testing platform for Storybook (a Chromatic alternative): upload
a built Storybook, render stories server-side with Playwright/Puppeteer, pixel-diff against per-branch
baselines, then review and approve. `docs/architecture/` is the current-state spec;
`docs/repo-structure.md` is the spatial index; `docs/adr/` records decisions.

## Toolchain

- **Package manager: nub/nubx** — not npm/yarn/pnpm. Lockfile is `nub.lock`. Node **24.x** is required
  (`devEngines.runtime`). If `node`/`nubx` is "command not found", prefix commands with
  `export PATH="$HOME/.nub/bin:$PATH"`.
- **Tasks: turbo.** Root scripts (`turbo build|lint|test|fmt|verify`) fan out per package.
- **Bundlers: tsdown for `packages/*`, rolldown for `apps/fly-app`.** Each package's `exports` map
  carries `{ source: ./src/..., default: ./dist/... }`; `apps/dev-server` runs TS source with no build.
- **Tests: vitest**, colocated `*.test.ts`. **Lint/format: oxlint** (type-aware) **+ oxfmt**.
- **Fixtures are not workspaces** — independent pnpm installs; never import from them or add them to
  `package.json#workspaces`.

## Commands

```sh
export PATH="$HOME/.nub/bin:$PATH"   # once per shell
nub ci                    # install workspace deps (once per clone/worktree)
nub run hook:install      # enable .githooks: fmt/lint staged files + conventional commits
nub run serve             # dev server from TS source, :3000, DATA_DIR=.dev-data, hot restart
nub run fmt | lint | test # turbo across the workspace
nub run docs:check        # ADR numbering, references, links, line cap
nub run lint:files        # oxfmt --check + oxlint on every tracked file the commit hook checks (CI runs it)
nubx turbo verify --force                              # build + lint + test, whole repo
nubx turbo verify --filter='@storyshelf/core' --force  # one package + deps
bash scripts/smoke.sh     # boot dev server, assert health/API/HTML

# Single test / typecheck, from a package dir:
nubx vitest run src/path/to/file.test.ts
nubx vitest run src/path/to/file.test.ts -t "test name"
nubx tsc --noEmit -p tsconfig.json

# The app's own Storybook (UI components + key pages):
#   nub run storybook (from the root; dev, :6006)
#   nub run build-storybook (from packages/app; -> storybook-static/, gitignored)

# Website, from apps/website: nub run dev | build | start   (start needs a prior build)
# Or from the root: nub run web:dev | web:build | docs
```

Real-browser suite (gated; `turbo test` stays hermetic):

```sh
# from the repo root
(cd fixtures/storybook-8 && pnpm install && pnpm run build-storybook)  # default, :6008
# storybook-9 :6009; storybook-10 :6010 (CSF-Next .test() entries)
npx -y playwright@1.63.0 install chromium   # one-time browser install
(cd packages/runner-playwright && nub run test:integration)
(cd packages/runner-playwright && FIXTURE_DIR="$(git rev-parse --show-toplevel)/fixtures/storybook-9" nub run test:integration)
# Puppeteer: set PUPPETEER_EXECUTABLE_PATH to a Chrome binary
```

CI runs `nub ci` → `docs:check` → `turbo verify` (affected on PRs; full on `main`, cached unless a
hash-wide file changed; forced nightly) →
`scripts/smoke.sh` → built-artifact smoke, plus fixture/browser matrix jobs. Reproduce locally
rather than pushing and waiting.

## Layout

- `packages/core` — `@storyshelf/core`: adapter interfaces, models, capture pipeline, job queue,
  diff, retention, publishing (no HTTP). Must not import Hono.
- `packages/app` — `@storyshelf/app`: Hono app, `/api/v1`, server-rendered JSX/HTMX UI.
- Adapters: `db-{sqlite,postgres,mysql}` (defaults node:sqlite/postgres.js/mysql2; cloud presets via
  subpaths), `storage-{local,s3,azure,gcs}`, `auth`, `image`, `affected`, `runner-{playwright,puppeteer}`,
  `notify-{git,chat,email}`, `design-figma`, `observability`, `ai`, `mcp`.
- `packages/cli` — `storyshelf` binary (upload/init/create/server/retry/purge; no Playwright).
- `apps/dev-server` (local, no build), `apps/website` (Astro Starlight docs), `apps/fly-app` (deploy demo).
- `fixtures/storybook-{8,9,10}` — Storybook 8.6 / 9 / 10 (pnpm, built on demand).
- `docs/` — `architecture/`, `repo-structure.md`, `testing.md`, `adr/`.

Terminology: `"app"` = the product UI (`packages/app`); `"website"` = the public docs site
(`apps/website`). They have different build, test and directory conventions.

## Architecture invariants

- **Composition.** Everything enters through `createShelfApp({ database, storage, testing, ... })`;
  each concern is an independent adapter. Models take adapters by constructor
  (`new BuildsModel(db, storage)`), never AsyncLocalStorage. The store is for router handlers only.
- **Capture is server-side.** The CLI uploads a built Storybook; the server renders it (no repo
  cloning). Baselines are per-branch with fallback to the default branch. Diffs use pixelmatch;
  builds are transient, baselines permanent.
- **Route classes.** Every registered route is classified `hosting | testing | review | both` in
  `packages/app/src/routes/api-routes.ts` / `page-routes.ts` (key `"METHOD /hono-pattern"`); the
  OpenAPI document marks each operation `x-storyshelf-class`. Classify every new route (including
  `app.all` handlers, which otherwise count as middleware) or
  `packages/app/src/routes/classification.test.ts` fails.
  `requireTesting` answers 404 for `testing` routes without `options.testing`; `requireReview` answers
  404 when a project has review off. Gate by class, never with an ad-hoc `if` in a handler; check
  `testingEnabled()` before linking to a `testing` page. No `testing` option ⇒ no capture, compare or
  baselines; `testing` requires a `runner` (`testing: {}` throws). `assertServerless` refuses a runner
  on AWS Lambda and warns on Vercel/Netlify (`STORYSHELF_ALLOW_SERVERLESS=1` overrides).
- **Capture targets.** `browser`/`browsers`, a snapshot's `browser`, and baseline keys hold a
  `CaptureTarget` (an engine or `<engine>@<name>`), never a bare `BrowserName`. Split with
  `parseTarget`/`engineOf`, validate with `isCaptureTarget`; the render input is `target`, not
  `browser`. Save a project's browsers only through `runnerTargets()`/`assertTargetsSelectable()`.
  A launch failure is a `TargetLaunchError`, not a story crash.
- **Public origin.** Never build absolute links from `config.publicBaseUrl` or a request's `Host`.
  Background work asks `createPublicOriginResolver(...)` (app: `Store.publicOrigin` /
  `runtime.publicOrigin`; jobs receive `publicOrigin()`). With no **confirmed** origin, send no
  notification and no link: every notification path calls `notificationOrigin(...)` first. Only
  authentication may use the request's origin, via `resolver.authOrigin(requestOrigin)`, and never
  from work that outlives the request.
- **Git state.** Never post a status from a call site. The pure `statusesForBuild` plus
  `BuildStatePublisher.request(buildId)` (app: `requestBuildState`) queues one `notify` job per git
  channel. A new status is a new case in `statusesForBuild`; a refused write throws so the consumer
  retries. GitHub check runs share that mapper
  (`packages/notify-git/src/github-check-mapper.ts`); the private key is the channel secret and must
  never appear in config, logs, errors or API output.
- **`cancelled` is terminal.** Cancel through `announceBuildStatus` (`build:cancelled`; no
  `build:failed` / `sys:capture-failed`). `BuildModel.update`/`setStatus` refuse other statuses for a
  cancelled build; `finalizeBuild` and the orchestrator skip it; only `resetStatus` (retry) leaves it.
  Treat `cancelled` like `failed` anywhere a build is reviewed, moved or promoted (409, no verdict).
- **Signed Storybook URLs and read grants.** Two unauthenticated reads of a private build exist, each
  with its own token purpose, key, prefix and route (ADR 0007, ADR 0051). `GET /_s/:token/*`
  (`packages/app/src/routers/signed-storybook.ts`, class `testing`) takes `capture` tokens only; a
  `read` token or a token with no purpose is refused. `GET /_r/:token/*`
  (`packages/app/src/routers/read-grants.ts`, class `hosting`) takes `read` tokens only: one build, at
  most an hour, current secret only (`previousSecret` is never tried), every answer sandboxed,
  `private, no-store`, `no-referrer`. `packages/core/src/utils/storybook-token.ts` is the single owner
  of both prefixes (`STORYBOOK_TOKEN_PREFIX`, `STORYBOOK_READ_PREFIX`), the token shape, the derived
  key per purpose, sign/verify and the lifetimes: never type `/_s/` or `/_r/` or derive a key
  elsewhere. Mint a `capture` token only through `storybookUrlSource` (renders; it alone signs the
  purpose) and a `read` grant only through `mintReadGrant` (`redirectToReadGrant` for the sandboxed
  redirect, `previewBaseOf` for previews); `renderInSlices` re-mints capture tokens for long passes.
  Every published-file route goes through `publishedAccess` +
  `servePublishedFile`/`publishedRelativePath`; CORS only from `publishedCorsHeaders`; the sandbox
  header only from `sandboxHeaders` (route family + `config.storybookHosting.mode`, ADR 0051: never
  `allow-same-origin`). Both token routes are rate-limited per IP in one bucket before the token is
  read; every refusal returns one identical 404 (`refuseToken`) with `Cache-Control: private,
no-store`; never log a token (`redactSecrets`). Do not add routes under `/_s/` or `/_r/`, widen
  what a token grants, or accept one purpose on the other's route (ADR 0051 allows only these two
  routes plus the content host's `/_x/` exchange, purpose `exchange`, with #358; nothing more). Only `signedCacheControl`
  (`packages/app/src/routers/capture-cache.ts`) may give a signed answer freshness: a success for a
  `capture` grant on a manifest file, when `config.captureAssets.cacheMaxAgeSeconds` > 0, as
  `private, max-age=N` capped by the grant's remaining life. Never `public`/`s-maxage`, never from a
  query or header, and never let a runner set response headers. A signed-in viewer's own answer is
  `private, no-cache` with a content-hash `ETag` (`publishedCacheControl`).
- **Cookie boundary and writes** (ADR 0051, decision 9). A state-changing request that carries a session
  cookie, or that posts to sign-in or sign-up (`SIGN_IN_PATHS`, closing login CSRF), is refused (403) unless `Origin` is the portal origin or `Sec-Fetch-Site` is `same-origin` or
  `none`: `sameSiteWrites` (`packages/app/src/middleware/same-site-writes.ts`), mounted for every path,
  `/api/v1` included. `same-site` is not enough, because every content host is the same site as the
  portal and its pages are uploaded. In `subdomain` mode the portal origin is the configured one and the
  session cookie is `__Host-storyshelf_session` (`createShelfAuth({ hostSessionCookie: true })`; boot
  refuses sign-in without it); `readSessionCookie` is the one reader of every name. A content host sets
  only `__Host-storyshelf-grant` and never sees a portal credential. Do not add CORS to portal routes.
- **Review.** `projects.review_enabled` (default true) and `review_approvals` (default 1) are the only
  switches; there is no `ShelfOptions` field. Verdicts live in `build_reviews` (`BuildReviewModel`;
  newest row counts) and are attributed by `resolveReviewer` (session user or bearer-token owner;
  auth on and no user ⇒ 403). A verdict waits for publishing (`publishingOf`). Every verdict move
  calls `announceBuildStatus` and `requestBuildState`. `deriveReviewStatus` applies only with testing
  off; with testing on the snapshot rollup decides. Review forms post to page routes
  (`packages/app/src/routers/review-forms.ts`, class `review`) because browser forms cannot post JSON
  to `/api/v1`; the review switch form is classed `hosting` so it stays reachable. Comments anchor to
  exactly one of build, story (`storyId`) or snapshot. MCP exposes comments, never verdicts.
- **Accessibility is informational.** `run_a11y` is on by default. Runners put axe lines on
  `RenderedSnapshot.a11y`; they are stored in `snapshots.a11y_violations` and read only through
  `a11yViolationsOf` / `a11yFindingsOf` / `a11ySummaryOf`. `axe unavailable: <reason>` is a note, not
  a finding. Never change a status, failure set or git state because of a11y results.
- **Settling and Storybook tests.** Runners wait for Storybook's own events through the public
  `Channel.on` (`packages/runner-*/src/settle.ts`), falling back to `delay ?? 500`; keep the two
  runners' copies identical. `projects.run_tests` (default off) runs `subtype: "test"` entries through
  `runProjectTests`/`CaptureRunner.runTests`; results are stored once as JSON in
  `builds.test_results` (`BuildModel.setTestResults`). A failing test is a blocking failure; never
  render a test entry as a story or add a test table.
- **Publishing and the queue.** Publishing is independent of capture. Small zips extract inline;
  larger ones are `publish` jobs. Every publish route ends in `PublishCompleter.complete`
  (`publishVerdict` is the one acceptance rule). Every job is a row in the one database table
  (`capture_jobs`); `packages/app/src/jobs-setup.ts` wires one consumer per queue: the main queue
  (capture + publish, retry limit `testing.retries`) and, on a long-running host, the `notify` queue
  (`NOTIFY_MAX_ATTEMPTS`). No in-memory queue. `testing.leaseSeconds` is the lease, renewed by
  `keepJobLease`; lease expiry/redelivery recovers work. A new job kind follows ADR 0040: a handler,
  an `exhausted` hook if it can lose a lease, its retry limit declared with its queue, and its own
  consumer (not a priority) if it must not wait behind capture. Cancel all kinds with
  `cancel(buildId)`. Forked capture's parent consumes; the child never reads the queue.
- **Catalog and UI.** Library/component/build pages render from `catalogOf()`
  (`packages/app/src/store.ts`), never `index.json` directly. The component preview is click-to-load in
  a sandbox without `allow-same-origin`. UI is server-rendered hono/jsx + HTMX + hono/css; no client
  framework and no UI adapter. Compose facades from `packages/app/src/ui/components.tsx` (`Button`,
  `Tabs`, `Badge`, `Alert`, `EmptyState`, `Stat`, `Field`, `Card`, `PageHeader`, `HStack`, `VStack`, …);
  never raw `btn`/`tabs`/`card` classes, `style="..."`, or direct family imports. Styles are colocated
  via `packages/app/src/ui/css.ts`: one labeled `css` template per variant composed with `${base}`
  (not `cx`), static values only. `packages/app/src/ui/consistency.test.ts` is a zero-tolerance
  ratchet. `src/ui/` is presentational: it never imports `store.ts`, `routers/`, `middleware/`,
  `pages/`, `@storyshelf/core/models` or `@storyshelf/core/test-helpers` (the same test enforces it);
  the app-coupled chrome (`DocumentLayout`, `csrfField`, sidebar, top bar, client scripts) lives in
  `packages/app/src/shell/`, so extracting `ui/` later is a folder move. **A new component or variant ships with a story** (`*.stories.tsx` beside it, titled
  `UI/<Component>`; pages are `Pages/<Area>/<Page>`, one story per state): `packages/app/.storybook/`
  renders the real hono/jsx with the app's own styles, tokens and theme, and `turbo verify` builds it,
  so a broken story fails the PR. Story-only fixtures live in `src/stories-fixtures/` (typed with the
  real row types, fixed ids, clock frozen at `STORY_NOW`); story-only stand-ins for server modules
  (`store.ts`, `middleware/csrf.ts`, the icon sprite, Node built-ins) live in `.storybook/shims/`,
  never as a production branch. Load the `ui-building-blocks` skill before touching UI.
- **Turbo cache inputs.** CI restores `.turbo/cache`, so a task hash must cover everything it reads.
  Shared files belong in `globalDependencies`; a test reading outside its package needs that file in
  the package's `turbo.json` (`extends: ["//"]`, `inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/<path>"]`).
  Check with `nubx turbo run build lint test --dry=json`. Live-cloud workflows use `--force` on purpose.
- **Logging and HTTP.** Use pino from core (`createShelfLogger()`): structured objects, never string
  interpolation (`logger.info({ buildId }, "msg")`), errors as an `err` child. Adapters receive scoped
  loggers via `Adapter.setLogger` and never create their own. Outbound HTTP only through
  `@storyshelf/core/utils` (`httpJson`/`HttpError`); never add `ky`/`ofetch`. On every span (core,
  `observability`, `ai`), record an exception only as a redacted copy (core's `spanException`, or
  the wrappers' own copy of it), rethrowing the original.
  An `HttpError` is recorded as `HTTP <status>`, never its body; log and trace a request URL only as
  `redactUrlForLog(url)` (origin only).
- **Remote browsers.** `defineRemote` expands to `<engine>@<name>` targets; presets are plain
  configuration, no vendor SDKs. Measure the environment in-browser (`inPageProbe`), never from the
  host. `protocol`/`reach` are declared, not inferred. Use `connectLeased`/`shutdownRemote` so a lease
  is released exactly once; scrub endpoints, headers and leases (`scrubConnection`) and never log
  them. A `reach: "url"` target needs a server secret and a confirmed origin; its URL is always
  `<origin>/_s/<token>/` (`storybookBase`). Measure the environment through `boundedProbe`
  (`timeouts.probeMs`): an overrun or failure is unknown plus a warning, a cancel throws
  `Capture cancelled` and never becomes an unknown-environment capture; close the probe page on
  every path and release the lease as `cancelled` when the run was cancelled. The optional
  `maxConnections` is a separate per-process limiter (`remote-limiter.ts`), never the page gate: its
  slot is taken before `connect` and freed with the lease, exactly once.
- **Boot replay.** `runBootTasks` re-requests open build states after startup only when notifiers are
  wired and an origin is resolved. Chat, email and alerts are never replayed.
- **Retention lifecycle.** Every baseline mutation goes through the fenced
  `buildReferenceLifecycle` capability when the adapter has it; never check references and then
  write or delete separately. Builds move `available` → `deleting` (irreversible); storage is
  deleted only after the tombstone commits. Never guess a baseline's source build. Without the
  capability, testing deployments fail closed for purge and branch GC. See ADR 0039.
- **MCP follows route classes.** A tool that calls `testing` routes sets `routeClass: "testing"`; the
  server hides it unless `GET /api/v1/health` reports `testing: true`.
- **Architecture direction.** Protect the self-hosted, vendor-independent workflow: assess recovery,
  portability and whether a result accurately reports what was compared. ADR 0037 (portability) is
  proposed direction; ADR 0038 (environment migration/review) is accepted as the target but not yet
  implemented. ADRs 0003 and 0009 describe current behavior until that work lands. ADR 0041 (schema
  source of truth) is accepted but not yet implemented; until its neutral tables land, change a
  table in every dialect's DDL, Drizzle schema and migration, plus the core row type. ADR 0047
  (toolchain on Vite+ and pnpm) is accepted, gated by a spike; until its epic merges, nub and turbo
  as described here stay the toolchain. ADR 0048 (installable app, offline Storybooks, web push)
  is accepted: the one service worker caches only opted-in default-branch Storybooks and the
  offline home page, never app HTML or `/api/v1` answers. ADR 0049 (built-in integrations) is accepted: git, chat, email, push and design integrations
  move into `packages/core/src/integrations/`, `@storyshelf/image` folds into core, and the app
  stops requiring observability; until its epic merges, the packages listed under Layout stay. ADR 0050 (cloud deployment) is
  accepted: no per-cloud packages; a cloud preset lives in the package it serves, and infrastructure is a
  versioned Terraform module per cloud on the published image.
- **Story sources.** Storybook is the only source; a new one is built into core (ADR 0001 amendment 2026-11-11), and no new Storybook-specific sites outside the files that hold them.

## Conventions

- **IDs** are ULIDs; **timestamps** are ISO-8601 strings in the database.
- **Commits** are conventional (`feat:`, `fix:`); pre-commit rejects unformatted or unlinted files.
  Fix with `nub run fmt` and re-stage; do not bypass hooks.
- **Changesets.** A pull request that changes shipped behavior (the source of `packages/*`, or a
  published `package.json`) adds a changeset: `nub run changeset <patch|minor|major>`, one Markdown file in `.changeset/`
  whose body starts with one line `<Kind>: <summary>` (≤ 100 characters; Kind `Breaking`, `Added`,
  `Changed`, `Fixed`, `Security` or `Internal`), then a blank line and the details. The summary is
  the release note; mark stories, tests and groundwork `Internal`. Never edit `CHANGELOG.md` by hand and never bump versions;
  `release.yml` does both (ADR 0043). Docs, tests and CI changes add none; the `no-release` label
  tells the CI check so. Task PRs on an epic branch add theirs there.
- **URLs** come from the `UrlBuilder` of `createUrlBuilder` (`@storyshelf/core/urls`; in the app,
  the store's `urls`), never hand-built strings. **Forms** use HTMX `hx-post` + `HX-Redirect`.
  JSON endpoints live under `/api/v1`; HTML pages at `/`.
- **Module layout.** Put the primary export first (purpose obvious within the first screen). Split a
  module at ~150 lines or 3+ concerns. Adapters follow per-kind layouts (storage:
  `types`/`keys`/`client`/`lifecycle`/`operations`/`streams`/`errors`; runners:
  `types`/`browser`/`runtime-params`/`pipeline`/`screenshot`/`play`/`a11y`). `index.ts` is a
  composition root, not a logic dump. Keep the package `exports` map frozen; a new module needs a
  colocated `<module>.test.ts` (indirect coverage only for pure mappers). Load the `adapter-layout`
  skill for templates.
- **One production owner per third-party dep.** A runtime dependency belongs in exactly one package's
  `dependencies` (e.g. `pino` and `axe-core` in core); other packages use `devDependencies` and import
  types through the owner (`@storyshelf/core/logger`), never directly.
- **Tests.** Every model, router and adapter needs tests (target 100% coverage). `nub run test` must
  stay hermetic; real-browser is gated by `RUN_INTEGRATION=1`; live cloud by `LIVE_CLOUD=1`. See
  `docs/testing.md` for the adapter matrix and determinism rules. Do not paper over flaky timing
  tests with `skip`; packages with timing-sensitive tests carry a `test:flake` script, the nightly
  canary (`docs/testing.md`).
- **ADRs.** Current ADRs are 0001-0018 plus 0037+; archived ADRs are 0001-0036 under `archive/`.
  A bare `ADR NNNN` means a current ADR. Do not edit `archive/`; new ADRs start at 0037. ADRs are
  decision records (target 250 lines, hard cap 320); `docs/architecture/` owns entities/interfaces.
  Run `nub run docs:check` after touching an ADR or a reference.
- **Temp files:** use repo-local `.tmp/` (gitignored), not `/tmp`; local server data lives in
  `.dev-data/` (gitignored).

## Lint rules that bite (oxlint, type-aware)

- `TS4111`: no dot access on index signatures — use `obj["key"]` for `Record<string, unknown>`.
- Complexity ≤ 20, max-statements ≤ 10, max-lines-per-function ≤ 50 — split helpers; never add
  path-based lint exemptions.
- Every regex needs the `u` flag (`require-unicode-regexp`).
- Use `toSorted()` (not `sort`), wrap array callbacks as arrows, hoist pure helpers out of closures.
- JSX `<script>` content must use `dangerouslySetInnerHTML={{ __html }}`.

## Worktrees and merging

- GitHub Issues (not `docs/archive/TASKS.md`) is the source of truth. Work only on the files listed in
  the issue's "Files to Modify".
- Work in a branch or git worktree; run `nub ci` once per worktree. `nub.lock` is per worktree — never
  run installs concurrently in the same tree.
- Verify before pushing (`nubx turbo verify --filter='<pkg>' --force`, or full). A task PR is a
  **squash merge**, one task = one commit, titled `<type>(<scope>): <short description> (#<task-id>)`
  where the scope is the package or area (e.g. `fix(cli): make the AWS stack boot (#423)`). PR titles
  use the same form. Reference the issue with `Closes #<n>` (or `Part of #<n>` for a partial slice).
- **Epic branches.** Work that belongs to an epic with an epic branch (listed in issue #370) targets
  `epic/<epic-issue>-<slug>`, not `main`; `main` only receives the epic branch as a whole, through a
  PR merged with a **merge commit** (never squash, so each task commit survives), titled
  `<type>(<scope>): <epic summary> (#<epic-issue>)`. Every push to an epic branch, and every epic
  PR into `main`, runs the full `verify`. Keep the branch current by merging `main` into it (never
  rebase or force-push a shared branch); land an epic, or a coherent finished part of it, within
  about two weeks. P0/security fixes, standalone issues and docs/config changes still target `main`
  directly. Any epic whose tasks change behaviour across several PRs gets an epic branch, because
  `main` is released weekly (ADR 0043).
- **Releases** (ADR 0043). `release-pr.yml` opens the release PR when a P0 PR (label `p0-critical`)
  or an epic merges into `main`, and otherwise once the last minor release is 7 days old; only the
  owner merges it. Label a P0 fix's PR `p0-critical`. There is no 1.0 yet: a breaking change is a
  `minor`, and a `major` changeset fails the changeset check.

## Agent operating model

The weekly usage quota is shared, so agents work in short, fresh sessions and talk through GitHub.

- **One session per issue.** The architect starts a developer session for one issue. It ends when
  the PR merges, and is then archived. Don't pick up a second issue in the same session; a new
  session reads the issue, AGENTS.md and the code, not old conversation.
- **At most one open PR per developer.** Finish, or hand back, before starting the next.
- **GitHub is the channel.** Questions go on the issue or PR with the `architect` label; status
  goes in the PR body. Use `send_message` only when you are blocked and a comment would not reach
  anyone. Never send acknowledgements, "FYI" notes or progress reports.
- **The owner talks to the architect** for priorities and decisions, or comments on a PR or issue.
  A comment on a PR wakes the session that owns it.
- **Merging is native.** `auto-merge.yml` turns on GitHub auto-merge when a PR from a branch of
  this repository opens or leaves draft (not forks, not `release/v*`). `pr-autoupdate.yml` brings
  the oldest queued PR up to date with `main`, one at a time, and GitHub merges it when `ci` and
  `changeset` pass and every conversation is resolved. So open a PR as a **draft** until it is
  verified and complete, and answer every review thread: an unresolved thread is what holds a
  green PR back.
- **Batch mechanical work.** A lint, story or rename sweep is two or three PRs, not one per file.
  Label those PRs `skip-review`, so CodeRabbit skips them.
- **Schedules.** Agents have two scheduled runs a day, 12 hours apart: the architect's triage. It
  answers `architect` items, enables auto-merge, revives open PRs that lost their session, starts
  sessions for ready issues (at most one per lane in #370), archives finished ones, and posts one
  digest comment on issue #370 when something happened. No other agent session runs on a clock (CI's
  own nightly workflows are unaffected).

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
