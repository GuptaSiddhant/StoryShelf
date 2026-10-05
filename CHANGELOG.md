# Changelog

All notable changes to StoryShelf. Versions follow the fixed-version scheme from
`scripts/release.mjs` (every workspace package shares one version).

## Unreleased

**Review page: draggable wipe handle and pixel-level zoom** (#40)
- The Swipe comparison now has a draggable handle on the divider (mouse, touch and pen); the slider below stays as the keyboard/screen-reader control and stays in sync.
- Zoom gains a 400% level, and zoomed-in screenshots render with `image-rendering: pixelated` so individual pixels are visible. `+`/`-` step the zoom; `f` still cycles.

**UI redesign: shell, review workspace, icon sprite** (ADR 0025)
- New app shell: full-height icon sidebar (collapsible rail, mobile drawer),
  slim neutral top bar with project switcher, theme menu, account menu and
  toasts. The customer accent now tints (brand mark, active nav, primary
  actions, derived `color-mix` washes) instead of flooding the top bar;
  `BrandTheme.topbarBg` is deprecated (still accepted, ignored). Default
  text colors now meet WCAG AA.
- Review page is a workspace: thumbnail filmstrip with filters, review
  progress, side-by-side / swipe / onion-skin / diff / flip comparison with
  zoom and synced scroll, a sticky action bar, a `?` shortcuts dialog, and
  auto-advance to the next open snapshot after approve/reject (HTMX, review
  page only). Bulk approve/reject now ask for confirmation.
- The top bar is now a project picker plus breadcrumbs of the page's ancestors
  (`Builds › main · abc1234` on the review page; the current page is named by
  its heading, and phones show just `‹ Parent`); the account menu, theme menu and sidebar collapse moved to the
  sidebar footer. `PageHeader` no longer takes `breadcrumbs`; pages pass
  `nav.trail` instead.
- Projects overview cards (previews, "to review" pill, filter), builds list
  (status chips with counts, branch select, table), library story filter,
  settings sub-navigation, and a chrome-free sign-in/invite layout.
- Icons are served as one SVG sprite at a content-hashed, immutable URL;
  htmx moves to a content-hashed URL too (the unversioned URL stays but now
  revalidates instead of being cached for a year).
- Forms: refreshed field styling and focus states, pending spinner on submit,
  confirmations on destructive actions, and success toasts after settings,
  project, profile, token, webhook, member and comment actions (server-set
  flash cookie). Validation errors now actually show: HTMX ignored the 400
  pages, and the tokens/labels/members/status tabs never rendered
  `globalError`. Comment forms no longer swap raw JSON into the page.
- Fixes: review keyboard shortcuts no longer fire on Cmd/Ctrl+R; the
  diff view switch matched a renamed class; document-level listeners were
  re-registered on every HTMX body swap.

**Observability: OpenTelemetry tracing, metrics, log correlation**
- New `@storyshelf/observability` package (single owner of all OTEL deps):
  env-driven SDK init (`initObservabilityFromEnv`, noop without
  `OTEL_EXPORTER_OTLP_ENDPOINT`), `@hono/otel` request spans with
  `storyshelf.req_id`/`enduser.id`, `db.*`/`storage.*` adapter wrappers,
  capture metrics, W3C queue propagation, and a pino `trace_id`/`span_id`
  mixin. Logs stay on stdout by design.
- Core emits `http.client` and `capture.job` (+ extract/render/persist
  phase) spans via `@opentelemetry/api`; queue payloads carry an optional
  `traceparent` so remote workers continue the uploading request's trace.
  `createShelfApp` mounts the middleware, serves instrumented adapters, and
  flushes the SDK on teardown (new structural `ShelfOptions.observability`).
- `storyshelf server init` (and worker) scaffolds include the wiring
  preamble; `createShelfLogger` accepts a `mixin`. See
  `docs/observability.md` and ADR 0022. No endpoint ⇒ behavior unchanged.
  The word `telemetry` is reserved for a future opt-in usage-reporting
  feature — this package never sends data to StoryShelf.

**Auth: admin-token bootstrap, user-bound tokens**
- New `ShelfConfig.adminToken` (`STORYSHELF_ADMIN_TOKEN`/`ADMIN_TOKEN` env):
  bearer grants site-admin API access before any user exists. Distinct from
  `secret` (session signing); never mints sessions.
- API tokens are bound to their creating user (`tokens.user_id`) and resolve
  to that user's live project role; bearer callers are now subject to route
  role requirements. Legacy ownerless tokens resolve as viewer; tokens whose
  owner is deleted are denied. Re-issue CI tokens that approve or manage.
- Project creation records the session creator as project admin.
- **Action required after upgrade:** re-create CI tokens used for
  approve/reject/manage flows; run DB migrations for the new `user_id` column.

**Auth: site-viewer auditor, OIDC team sync**
- New site `viewer` role: read-only visibility into all projects without
  membership; explicit membership takes precedence. Request logs carry the
  user id on request end for read attribution.
- OIDC adapter generalizes endpoints via Discovery (Keycloak layout fallback),
  extracts group memberships from configurable claims, and ships Keycloak,
  Okta, Entra ID, Cognito, and Auth0 presets. `adminGroups`/`viewerGroups`
  map groups to site roles (exact match); Entra group overage fails closed.
- New `project_group_mappings` table maps IdP groups to project roles per
  project (API + Members settings tab); login syncs memberships (highest role
  wins, removals revoke synced grants only, manual grants untouched).
- **Action required after upgrade:** run DB migrations for `project_members.source`
  and the new `project_group_mappings` table.

**New adapters**
- `@storyshelf/queue-redis` — Redis-backed remote capture queue (`ioredis`).
- `@storyshelf/storage-azure` — Azure Blob Storage adapter.
- `@storyshelf/storage-gcs` — Google Cloud Storage adapter.

**Adapter lifecycle**
- `AdapterLifecycle` is now mandatory and all-or-nothing: every adapter
  implements `setup`/`teardown`/`health`. Storage `health` results no longer
  report `latencyMs` (they return `{ ok }`).

**JSR**
- `@storyshelf/app` ships the `hono/jsx` import map so JSX rendering resolves on
  deno/JSR consumers.

## 0.5.2 — Docs, screenshots, cloud targets (2026-09-23)

**Cloud deploy targets**
- `storyshelf server init` gained AWS, Azure, and GCP Terraform reference stacks.
- New adapters: `@storyshelf/storage-azure`, `@storyshelf/storage-gcs`,
  `@storyshelf/queue-azure` (Storage Queues + Service Bus), plus GCP Pub/Sub.
- Opt-in live-cloud test suites and CI workflows for AWS, Azure, and GCP.

**Capture & UI**
- Per-project capture browser switch; selectable Playwright or Puppeteer runner.
- Per-story viewports from the Storybook viewport config; runtime preview
  fallback for story parameters; `waitForReady` hook honoured.
- Per-attempt build log history with retry support; host-owned runtime loggers
  via `Adapter.setLogger`.
- New library gallery with branch picker and per-story deep links.
- Refreshed UI theme; stylesheet served unescaped so fonts and selectors survive.

**Auth**
- Tiered shared passwords (admin/viewer) for the demo deployment.

**Docs**
- Core concepts section, grouped guides, Chromatic comparison and migration
  guides, screenshots across the site, `storyshelf.js.org` as canonical domain.

## 0.5.1 — Pre-launch UX polish (2026-09-15)

- Fixes from the pre-launch UX audit; clearer sidebar Developer section.
- Publish fixes: real semver for `catalog:` specs, bundled `LICENSE` for JSR.

## 0.5.0 — Rename to `app`, per-project browsers (2026-09-06)

**Breaking rename**
- `@storyshelf/router` → `@storyshelf/app`; `createShelfRouter` →
  `createShelfApp` (ADR 0018 was the split, this release makes the name
  permanent). Migrate imports and the `createShelfRouter(...)` call.
- The old `@storyshelf/router` name is deprecated on npm/JSR.

**Capture**
- Per-project browser and viewport configuration (`core`, `db`, `runner`).
- A11y annotation support, `staticServer` utils, and browsers metadata
  (`core`, `runner`).

## 0.4.0 — `db-postgres`, worker, HTTP helper (2026-09-06)

**New packages**
- `@storyshelf/db-postgres` — Postgres adapter for managed providers; the CLI
  gained `create server`/`init` support for a Postgres option with a local
  Docker Compose service.
- `@storyshelf/worker` — remote capture worker with SQS queue and hybrid CLI.

**Domain split (ADR 0018)**
- `@storyshelf/router` (the HTTP layer) is split out of `@storyshelf/core`;
  core stays domain-only. Renamed `app` in 0.5.0.
- Models are dialect-agnostic over the widened `DatabaseAdapter` (tables as
  interface); SQLite-specifics live in `db-sqlite`. Drizzle factories colocate
  under `core/src/db`.

**Retention & purging**
- TTL branch GC: daily sweep removes stale baselines; orphan baseline storage
  objects are deleted on GC.

**HTTP & logging**
- Shared `httpJson`/`HttpError` helper in `core` (timeout + retry with
  `Retry-After`); fetch-based git providers (ADR 0019).
- Single pino owner in core (`createShelfLogger`), env-driven level default
  (ADR 0014).

**CLI**
- New `build`, `doctor`, `whoami`, `upload --dry-run`, `server serve`,
  `jsr archive/unarchive` commands.
- Drops `zod` for hand-rolled config validation; publishes npm-clean on npm
  as bare `storyshelf` (and is no longer published to JSR under `@storyshelf/cli`).
- Detects the user's package runner for builds and scaffolding.

**Tooling & hygiene**
- oxfmt/oxlint pre-commit hooks with conventional-commit gate.
- LICENSE (MIT) + npm/JSR keywords on publishable packages; `primary export
  first` lint enforced; dense router/core modules broken down into helpers.
- Topological publish order derived from manifests; GitHub Release split into
  its own job; OIDC check runs early.

## 0.3.2 — Release tooling & retention fix (2026-09-06)

- `latestPerBranch` retention query now uses the query builder and honors
  `orderBy` (fixes camelCase-column failure on real databases).
- Publish order derived topologically from manifests; validation gates once;
  npm/JSR publishers depend only on that gate (JSR failures never block npm).
- Release pipeline inline scripts extracted to `scripts/`; `check-npm-oidc`
  fails fast before install.

## 0.3.1 — Release fix (2026-09-06)

- Fix `ref_name` evaluation in the release workflow (double-brace expressions).

## 0.3.0 — Streaming uploads + webhook secrets (2026-09-06)

**Webhook secrets encrypted at rest (#45)**
- `webhooks.secret` (plaintext) is replaced by `secret_encrypted` (AES-256-GCM
  under `ShelfConfig.secret`). The legacy column is dropped by migration —
  pre-existing plaintext secrets are **discarded, not migrated**.
- **Action required after upgrade: re-create webhooks.** Until then, deliveries
  for old webhooks fail closed (skipped, never crash). Creation fails loudly
  when `SECRET` is unset.
- `WebhookModel` now takes the server secret (`new WebhookModel(db, secret)`);
  `DatabaseAdapter` no longer exposes top-level `migrate()`/`close()` (see
  #59 lifecycle); `emitWebhookEvent` takes the secret as its final argument.

**Streaming uploads replace multipart (#53)**
- `POST /api/v1/projects/:slug/builds` accepts only `application/json` and
  returns `{ build, uploadUrl }`; the bundle streams via
  `PUT …/builds/:buildId/zip` (new `StorageAdapter.writeStream/readStream`;
  `maxUploadBytes`, default 1 GiB, enforced with `413`). The multipart form
  route is removed — servers answer old CLI uploads with `4xx`.
- **Action required after upgrade: upgrade the CLI.** Old servers are not
  supported by the new CLI (no fallback); old CLIs cannot upload to new
  servers. The deprecated `--storybook-dir` alias is removed (use
  `--build-dir`); JSON creation accepts `labels: [{ key, value }]`, and the
  CLI gained repeatable `--label key=value`.
- Small zips persist Storybook statics inline at upload time.

**Adapters**
- Mandatory metadata category plus adapter lifecycle and two-tier health.

## 0.2.0 — Repository restructure (2026-09-05)

Internal reorganization with a small, documented public-surface cleanup. See
`docs/migration-0.2.md` for the import-path changes.

**Public surface (`@storyshelf/core`)**
- Barrel is router-only: `createShelfRouter` + option/config/app types. All
  values moved to subpaths (new entries: `core/logger`, `core/capture`,
  `core/adapter/capture-queue`, `core/paths`, `core/urls`, `core/diff`).
- Internal tooling (`store`, `middleware`, `retention`, pages) has no public
  entry and may change without notice.

**Core layout (`@storyshelf/core`)**
- `schema/` per-entity directory replaces `schema.ts` + `schema-tables.ts` (one module
  per entity, mirroring `models/`; DDL drift-guard test added).
- Barrel (`@storyshelf/core`) now also exports `models/*`, `middleware/*`, and the
  request `store`. Model modules no longer re-export row types.
- `index.tsx` (482→~250 lines): capture dispatch (`capture/dispatch.ts`),
  merge/dedupe skip checks (`capture/skip-checks.ts`), and middleware factories
  (`middleware/request-log.ts`, `store-scope.ts`, `auth-gate.ts`) extracted.
- Settings router split by tab area (`settings.handlers.ts` + `settings-*.ts`);
  `build-diff` page split into section components; `ui/components.tsx` is now a
  facade over `ui/{buttons,feedback,forms,layout}.tsx`.
- Test doubles moved to `test-helpers/` (never shipped); `status-fanout.test.ts`
  colocated with its implementation.

**Adapters**
- New `createDrizzleAdapter` factory (`core/adapter/database`); `db-sqlite` and
  `db-turso` are thin driver shims. Adapter tests gained exact type inference.
- `db-sqlite` runs on the `node:sqlite` builtin via `drizzle-orm/sqlite-proxy`
  — zero native dependencies (`better-sqlite3` removed). Same signature, same
  WAL mode, same schema.
- New shared `upsertReviewComment` flow (`core/adapter/git-host/comments`);
  `git-github` / `git-gitlab` comment modules are thin provider bindings.

**Apps**
- `dev-server` and `fly-app` stay separate launchers owning their own adapter
  wiring, so deployments can diverge (locals vs Turso/S3). Shared code lives in
  `packages/`, not `apps/` (a shared-assembly experiment was evaluated and
  reverted for exactly this reason). `apps/` packages are unversioned (the
  release script only versions `packages/`).

**CLI (`@storyshelf/cli`)**
- `create`/`init`/`upload` accept an optional `cwd` (test seam, backward compatible).
- Command test suite added (config, create, upload, init, retry, purge).
- All file-wide `oxlint-disable` headers removed (`index`, `config`, `create`,
  `init`, `upload` refactored into small helpers).

**Repo hygiene**
- `docs/repo-structure.md` added (annotated map; bundler rule: tsdown for libs,
  rolldown for apps); `AGENTS.md` / `README.md` drift fixed.
- `.oxlintrc.json`: deleted the `packages/core/src/**` wildcard and the hardcoded
  file list; legacy violations tracked per-file (see open issues) instead.
- `turbo.json` build outputs scoped to `dist/**`.

## 0.1.3 and earlier

See GitHub releases (`v0.1.x` tags) for the pre-restructure history.