# Repository Structure

Annotated map of the StoryShelf monorepo. `AGENTS.md` is the workflow guide; this file is the spatial index.
For a visual overview, see [`architecture-diagrams.md`](./architecture-diagrams.md) §2 (Package Map) and §3 (Adapter Composition).

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

There is no `tsdown-entry` key. Each library `package.json` `exports` map carries `{ source: ./src/..., default: ./dist/... }`, plus a dist-only `publishConfig.exports`. The release publishes with `npm publish`, which does not apply `publishConfig.exports`, so the published manifest still carries the `source` conditions (#393). `storyshelf` (cli) and `@storyshelf/mcp` have plain `dist` exports and no `source` condition. `nub.jsonc → conditions: ["source"]` and `tsconfig.base.json → customConditions: ["source"]` resolve workspace imports to `.ts`/`.tsx` source in dev, editor, and `tsc`.

## Public import surface

- `@storyshelf/app` root barrel is the HTTP app: `createShelfApp` plus
  `ShelfApp`/`ShelfRouter`/`ShelfContext`/`ShelfLifecycle` and the re-exported
  option types (`ShelfOptions`/`ShelfConfig`/`UIConfig`/`BrandTheme` from core).
- `@storyshelf/core` root barrel is domain-only (config/logger/types surface).
  Importing it must never pull Hono into bundles that do not serve it
  (e.g. runners, the forked capture child) — enforced by keeping all HTTP modules in app.
- Everything else lives under a subpath: adapter interfaces under
  `core/adapter/*`, runtime capture under `core/capture`, logging under
  `core/logger`, diff under `core/diff` (re-exported from the leaf `@storyshelf/image`), URLs under `core/urls`, storage paths
  under `core/paths`, tables/rows under `core/schema`, models under
  `core/models`, config under `core/config`, retention under `core/retention`,
  shared utils under `core/utils`, in-memory fakes under `core/test-helpers`.
  Internal tooling (`store`, `middleware`, pages) has no entry outside app
  and may change without notice.
- `Logger` canonical home is `core/logger` (the `core/types` re-export was
  removed in 0.2.0).
- `@storyshelf/ai` exports only `createAi` and its option types; the `Ai` contract
  (`core/ai`) and the pure evidence/redaction/budget code (`core/insights`) live in
  core so `ShelfOptions.ai` needs no dependency on the implementation package.
- `@storyshelf/mcp` is a thin `/api/v1` client (no core models/DB). Public surface: the `storyshelf-mcp` bin and the `@storyshelf/mcp/http` subpath (`createMcpHttpHandler`, `serveHttp`); tools stay internal (ADR 0017).
- `@storyshelf/observability` root barrel is runtime-agnostic (`@opentelemetry/api`
  only); the Node SDK lifecycle lives under `observability/node`. `core` never imports `observability` (no-cycle rule,
  ADR 0015 §5) — cross-package span/propagation helpers are intentionally
  duplicated, not shared.

## Schema layout (0.2.0 target, R2)

- `packages/core/src/schema/` — one module per entity, mirroring `packages/core/src/models/` 1:1 (`project.ts`, `build.ts`, `snapshot.ts`, `baseline.ts`, `comment.ts`, `label.ts`, `token.ts`, `webhook.ts`, `member.ts`, `user.ts`).
- The DDL is hand-written per dialect in `packages/db-{sqlite,postgres,mysql}/src/ddl.ts`; there is no `packages/core/src/ddl.ts`. A single source of truth is the target of ADR 0041 (accepted, not yet implemented).
- `@storyshelf/db-sqlite` owns the SQLite schema/DDL/shared factory; `./turso`, `./better-sqlite3`, `./bun-sqlite`, `./d1` are driver presets over it (R3).

## App convention (lives in `packages/app/src/`)

- One router module per area (`routers/builds.ts`, `routers/tokens.ts`, …).
- When a router exceeds ~150 LOC, split into `<area>.handlers.ts` (data loading,
  shared helpers, schemas) plus per-concern route modules (`settings-general.ts`,
  `settings-tokens.ts`, …) behind a thin `<area>.ts` composer that only calls
  the registrars. `routers/builds.ts` + `builds.handlers.ts` and `routers/settings*.ts`
  are the reference implementations.
- Pages follow the same rule: section components in `<page>-<section>.tsx`
  (`build-diff-header/nav/viewer/comments.tsx`), composed by a thin `<page>.tsx`.
- Storybook (`packages/app/.storybook/`, `src/**/*.stories.tsx`, `src/stories-fixtures/`) is the
  design-system showcase: every shared component and the key pages, light and dark, from the real
  source. `main.ts` aliases a few server-only modules to `.storybook/shims/` (store, csrf, icon sprite,
  Node built-ins); `render.tsx` renders JSX to HTML like `c.html()`; `page.tsx` shows a page's full
  document in a frame. It is a dev dependency only: `files` and `exports` are unchanged, nothing
  story-related is published, and `turbo verify` builds it (`build-storybook`).
- UI primitives live in `ui/` by family (`buttons`, `feedback`, `forms`, `layout`)
  behind the `ui/components.tsx` facade — import from the facade. `ui/` is presentational (no
  store, routers, middleware, pages or core models; `consistency.test.ts` enforces it). The
  app-coupled chrome lives in `shell/`: `DocumentLayout`, `csrfField`, the sidebar and top bar,
  and the boot and client scripts.

## Test placement

- Unit: colocated `*.test.ts` next to sources (hermetic, `nub run test`).
- HTTP-level: `*.integration.test.ts` in the same dirs (fake capture runner, still hermetic).
- Real browser: `RUN_INTEGRATION=1` gates `test:integration` (Playwright + `fixtures/storybook-8` by default, `FIXTURE_DIR=` override).
- Test-only helpers live in `packages/core/src/test-helpers/` — never in shippable `src/` modules (R2 moves `capture/fake-adapters.ts` there).

## Config ownership

| File                                  | Owns                                                                                                                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` (root)                 | Workspaces list, `catalog` pins (dev tools: TS, tsdown, vitest, oxlint/oxfmt, pino, yaml)                                                                                                                                                                   |
| `nub.jsonc`                           | `source` condition, isolated linker, public hoists                                                                                                                                                                                                          |
| `turbo.json`                          | `build → ^build`; `lint/test/test:integration` need `^build`; `verify = build+build-storybook+lint+test`                                                                                                                                                    |
| `config/tsconfig.base.json`           | Strict TS, `hono/jsx`, `customConditions: ["source"]`                                                                                                                                                                                                       |
| `config/tsdown.ts`                    | `libConfig` / `cliConfig`                                                                                                                                                                                                                                   |
| `.github/workflows/app-storybook.yml` | Dogfood: builds `packages/app`'s Storybook and uploads it to the demo project `storyshelf-ui` with the published CLI, like a customer (`packages/app/.storybook/storyshelf.json` holds url, slug, `untraced`); separate from `ci.yml` and the Fly demo seed |
| `.oxlintrc.json`                      | Rule-based lint (no per-file path exemptions)                                                                                                                                                                                                               |
| `scripts/`                            | Repository automation and tooling (`release.mjs`, `release-detect.mjs`, `version-packages.mjs`, `changeset-add.mjs`, `changeset-check.mjs`, `public-packages.mjs`, `npm-trust-all.mjs`)                                                                     |
