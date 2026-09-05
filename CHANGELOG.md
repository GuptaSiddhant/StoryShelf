# Changelog

All notable changes to StoryShelf. Versions follow the fixed-version scheme from
`scripts/release.mjs` (every workspace package shares one version).

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
