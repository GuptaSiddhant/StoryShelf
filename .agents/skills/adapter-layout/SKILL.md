---
name: adapter-layout
description: Split crammed adapter modules into one-concern-per-file layouts with clear names, frozen public exports, and colocated tests; use when creating a new adapter package, splitting a module over ~150 lines, or reviewing adapter file organization
license: MIT
metadata:
  audience: maintainers
  scope: packages/*
---

# Adapter Layout — One Concern Per File

Adapters are the most-read code in this repo. A module earns a split when it exceeds **~150 lines** or holds **3+ distinct concerns** (client construction, lifecycle, serialization, operations, streaming, error mapping). Copy the per-kind layout below; copy the exemplar packages (`storage-s3`, `notify-git`, `runner-playwright`) — never invent a new shape.

## When to use me

Use when:

- Someone says "split this adapter", "file is too big", "crammed into index.ts", or "new adapter package"
- A module passes ~150 lines or mixes 3+ concerns
- Reviewing whether a new module or export belongs in a package

Do not use for website docs, product UI, or CLI commands (different shapes) — redirect to AGENTS.md conventions.

## Assumptions & inputs

- Toolchain: `export PATH="$HOME/.nub/bin:$PATH"`, per-package `nub run lint`, `nub run build`, `nub run test`, `nubx tsc --noEmit -p tsconfig.json`
- Conventions: AGENTS.md (primary-export-first, no path-based lint exemptions, structured logging, `httpJson`, single prod dep owner, `*.test.ts` colocated, `*.integration.test.ts` gated)
- Relative imports use explicit `.ts` extensions (`./keys.ts`); files are flat `src/`, lowercase `kebab-case.ts`

## Target layouts

### Storage adapters (`storage-*`)

| File            | Owns                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `types.ts`      | `*StorageOptions` interface only, no logic                                                                          |
| `keys.ts`       | Key join (`s3Key`-style, stays exported) + private inverse split                                                    |
| `client.ts`     | Client construction/resolution + shared `ctx` type                                                                  |
| `lifecycle.ts`  | `setup` / `health` / `teardown`                                                                                     |
| `operations.ts` | Buffered CRUD + listing/pagination                                                                                  |
| `streams.ts`    | `readStream` / `writeStream` + failure cleanup                                                                      |
| `errors.ts`     | Not-found guards + stream/collect helpers                                                                           |
| `index.ts`      | **Hybrid composition root**: doc header, imports, factory wiring first, `Options` + key-helper re-exports at bottom |

### Notifiers (`notify-*`)

One file per concern, prefixed by the host when a package serves several: `<host>-api.ts` (base URL, headers, path joins), `<host>-config.ts` (zod schema for the channel config), `<host>-mapper.ts` (state/status mapping, pure), `<host>-status.ts` / `<host>-comment.ts` / `<host>-pr.ts` (operations), `<host>.ts` (provider descriptor + `create`, the composition root). Shared helpers live unprefixed (`state-adapter.ts`, `describe.ts`, `review-comment.ts`, `version.ts`). A provider declares `metadata.delivery` (`message` sends once, `state` shows a named state); `index.ts` lists the providers in one array (`gitNotifiers`, `chatNotifiers`) and re-exports the config schemas. Provider kinds must be unique across every notifier package wired into one app (`git-log`, not `log`).

### Runners (`runner-*`)

Extract pure stages, keep the factory file as root: `types.ts`, `browser.ts` (launch/close + run map), `runtime-params.ts`, `pipeline.ts` (orchestration), `screenshot.ts`, `play.ts`, `a11y.ts`. The existing `<name>.ts` factory file becomes the composition root; the barrel `index.ts` stays untouched.

## Rules

1. **Public surface frozen.** The package `exports` map does not change; new modules stay internal. The only exportable helpers are pre-existing ones (e.g. `s3Key`-style key joins, the `db-*` preset subpaths). A new subpath needs package-owner approval.
2. **Move tests with the code, and cover the contract.** Each new module gets colocated `<module>.test.ts`; move existing cases (and their fake-client harnesses) into it. Indirect coverage is allowed only for pure mappers (notify-git `github-mapper.ts` precedent). Never leave a suite testing through the old file path. Minimum per module:
   - `client.ts`: construction defaults + injected-vs-owned handles.
   - `lifecycle.ts` (or `index.ts` for single-file adapters): `setup` idempotent x2, `health` ok/fail, `teardown` x2 no-throw (see `docs/testing.md` §2a).
   - `operations.ts`/`streams.ts`/`keys.ts`/`errors.ts`: happy-path round-trip, not-found/error mapping, safety guard (traversal / malformed input).
3. **Thread context, don't duplicate.** When helpers shared one closure, define the `ctx`/state type once in `types.ts` and pass it as a parameter. Hoist pure helpers out of closures (lint `consistent-function-scoping`).
4. **Keep file headers.** Each module gets a one-line doc comment stating its concern (`/** Key join/split for … */`).

## Verification (per package, in order)

1. `nub run lint` — type-aware oxlint, zero warnings (complexity ≤ 20, statements ≤ 10, lines ≤ 50)
2. `nubx tsc --noEmit -p tsconfig.json`
3. `nub run test` — hermetic; every moved case still passes, no suite imports the old layout
4. `nub run build` — `dist/` gains no new entry points (`dist/index.mjs` only, plus pre-approved subpaths)
5. `git status` — only intended files; no `dist/`, lockfile, or stray edits
