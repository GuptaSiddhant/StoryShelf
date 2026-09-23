---
name: adapter-layout
description: Split crammed adapter modules into one-concern-per-file layouts with clear names, frozen public exports, and colocated tests; use when creating a new adapter package, splitting a module over ~150 lines, or reviewing adapter file organization
license: MIT
compatibility: opencode
metadata:
  audience: maintainers
  scope: packages/*
---

# Adapter Layout — One Concern Per File

Adapters are the most-read code in this repo. A module earns a split when it exceeds **~150 lines** or holds **3+ distinct concerns** (client construction, lifecycle, serialization, operations, streaming/polling, error mapping). Copy the per-kind layout below; copy the exemplar packages (`auth-oauth`, `git-github`, `queue-azure`) — never invent a new shape.

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

### Queue adapters (`queue-*`)

| File            | Owns                                                   |
| --------------- | ------------------------------------------------------ |
| `types.ts`      | `*Options`, queued-body and runtime/ctx types          |
| `client.ts`     | Client construction + ownership flags                  |
| `lifecycle.ts`  | `setup` / `health` / `teardown`                        |
| `codec.ts`      | Job serialize / `parseBody`                            |
| `operations.ts` | `enqueue` + remote no-ops (`status`/`active`/`recent`) |
| `poll.ts`       | `poll` / `ack` / `nack`, requeue payload, delay clamps |
| `index.ts`      | **Hybrid composition root** (same shape as storage)    |

### Runners (`runner-*`)

Extract pure stages, keep the factory file as root: `types.ts`, `browser.ts` (launch/close + run map), `runtime-params.ts`, `pipeline.ts` (orchestration), `screenshot.ts`, `play.ts`, `a11y.ts`. The existing `<name>.ts` factory file becomes the composition root; the barrel `index.ts` stays untouched.

## Rules

1. **Public surface frozen.** The package `exports` map does not change; new modules stay internal. The only exportable helpers are pre-existing ones (e.g. `s3Key`-style key joins, `queue-azure` subpaths). A new subpath needs package-owner approval.
2. **Move tests with the code.** Each new module gets colocated `<module>.test.ts`; move existing cases (and their fake-client harnesses) into it. Indirect coverage is allowed only for pure mappers (git-github `mapper.ts` precedent). Never leave a suite testing through the old file path.
3. **Thread context, don't duplicate.** When helpers shared one closure, define the `ctx`/state type once in `types.ts` and pass it as a parameter. Hoist pure helpers out of closures (lint `consistent-function-scoping`).
4. **Keep file headers.** Each module gets a one-line doc comment stating its concern (`/** Key join/split for … */`).

## Verification (per package, in order)

1. `nub run lint` — type-aware oxlint, zero warnings (complexity ≤ 20, statements ≤ 10, lines ≤ 50)
2. `nubx tsc --noEmit -p tsconfig.json`
3. `nub run test` — hermetic; every moved case still passes, no suite imports the old layout
4. `nub run build` — `dist/` gains no new entry points (`dist/index.mjs` only, plus pre-approved subpaths)
5. `git status` — only intended files; no `dist/`, lockfile, or stray edits
