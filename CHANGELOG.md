# Changelog

All notable changes to StoryShelf. Versions follow the fixed-version scheme from
`scripts/release.mjs` (every workspace package shares one version).

## Unreleased

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