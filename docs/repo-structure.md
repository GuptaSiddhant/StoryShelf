# Repository Structure

Annotated map of the StoryShelf monorepo. `AGENTS.md` is the workflow guide; this file is the spatial index.

## Workspaces vs fixtures

`package.json → workspaces.packages` covers `./apps/*` + `./packages/*` only (installed with `nub`, locked in `nub.lock`).

`fixtures/storybook-{8,9,10}/` are **not** workspaces: independent `pnpm` installs with their own lockfiles, built on demand (`pnpm install && pnpm run build-storybook`). `storybook-static/` output is gitignored. Never import from fixtures; never add them to nub workspaces.

## Bundler rule: tsdown for libs, rolldown for apps

- **Publishable packages** (`packages/*`): `tsdown` via `config/tsdown.ts` (`libConfig` for libraries, `cliConfig` for the CLI binary). Entry points derive from each `package.json` `exports` map.
- **Deployables** (`apps/fly-app`): `rolldown` (`rolldown.config.ts` bundles `server.ts` → `dist/server.mjs`).
- **No-build dev**: `apps/dev-server` runs TS source directly (`nub run serve`, `nub watch`).
- **Launcher ownership**: `apps/dev-server` and `apps/fly-app` each own their adapter
  wiring so deployments can diverge (locals vs Turso/S3). Shared code goes in
  `packages/`, not `apps/`.
  The CLI `server init` template is standalone by design (registry installs, no
  workspace), so the template carries its own copy of the wiring.

Rationale: tsdown targets distributable ESM libraries (dts, per-entry outputs); rolldown targets single-file app bundles. Do not swap them without updating this section.

## Export mechanism (not `tsdown-entry`)

There is no `tsdown-entry` key. Each `package.json` `exports` map carries `{ source: ./src/..., default: ./dist/... }` (plus `publishConfig.exports` rewritten to dist-only on publish). `nub.jsonc → conditions: ["source"]` and `tsconfig.base.json → customConditions: ["source"]` resolve workspace imports to `.ts`/`.tsx` source in dev, editor, and `tsc`.

## Public import surface

- `@storyshelf/core` root barrel is router-only: `createShelfRouter` plus
  `ShelfOptions`/`ShelfConfig`/`UIConfig`/`BrandTheme`/`ShelfApp`/`ShelfContext`.
  Importing the barrel must never pull the Hono router into bundles that do not
  serve it (e.g. runners, workers).
- Everything else lives under a subpath: adapter interfaces under
  `core/adapter/*`, runtime capture under `core/capture`, logging under
  `core/logger`, diff under `core/diff`, URLs under `core/urls`, storage paths
  under `core/paths`, tables/rows under `core/schema`, models under
  `core/models/*`. Internal tooling (`store`, `middleware`, `retention`, page
  components) has no entry and no barrel export — it may change without notice.
- `Logger` canonical home is `core/logger` (the `core/types` re-export was
  removed in 0.2.0).

## Schema layout (0.2.0 target, R2)

- `packages/core/src/schema/` — one module per entity, mirroring `packages/core/src/models/` 1:1 (`project.ts`, `build.ts`, `snapshot.ts`, `baseline.ts`, `comment.ts`, `label.ts`, `token.ts`, `webhook.ts`, `member.ts`, `user.ts`).
- `packages/core/src/ddl.ts` — DDL derived from the entity modules (single derivation function), not a parallel hand-written copy.
- `db-sqlite` / `db-turso` import the same schema from core (ADR 0002); they are driver shims over a shared factory (R3).

## Router convention

- One router module per area (`routers/builds.ts`, `routers/tokens.ts`, …).
- When a router exceeds ~150 LOC, split into `<area>.handlers.ts` (data loading,
  shared helpers, schemas) plus per-concern route modules (`settings-general.ts`,
  `settings-tokens.ts`, …) behind a thin `<area>.ts` composer that only calls
  the registrars. `routers/builds.ts` + `builds.handlers.ts` and `routers/settings*.ts`
  are the reference implementations.
- Pages follow the same rule: section components in `<page>-<section>.tsx`
  (`build-diff-header/nav/viewer/comments.tsx`), composed by a thin `<page>.tsx`.
- UI primitives live in `ui/` by family (`buttons`, `feedback`, `forms`, `layout`)
  behind the `ui/components.tsx` facade — import from the facade.

## Test placement

- Unit: colocated `*.test.ts` next to sources (hermetic, `nub run test`).
- HTTP-level: `*.integration.test.ts` in the same dirs (fake capture runner, still hermetic).
- Real browser: `RUN_INTEGRATION=1` gates `test:integration` (Playwright + `fixtures/storybook-8` by default, `FIXTURE_DIR=` override).
- Test-only helpers live in `packages/core/src/test-helpers/` — never in shippable `src/` modules (R2 moves `capture/fake-adapters.ts` there).

## Config ownership

| File | Owns |
|---|---|
| `package.json` (root) | Workspaces list, `catalog` pins (dev tools: TS, tsdown, vitest, oxlint/oxfmt, pino, yaml) |
| `nub.jsonc` | `source` condition, isolated linker, public hoists |
| `turbo.json` | `build → ^build`; `lint/test/test:integration` need `^build`; `verify = build+lint+test` |
| `config/tsconfig.base.json` | Strict TS, `hono/jsx`, `customConditions: ["source"]` |
| `config/tsdown.ts` | `libConfig` / `cliConfig` |
| `.oxlintrc.json` | Rule-based lint (no per-file path exemptions) |
| `scripts/` | Release/publish tooling only (`release.mjs`, `jsr.mjs`, `public-packages.mjs`, `npm-trust-all.mjs`, `prune-nub-lock.mjs`) |
