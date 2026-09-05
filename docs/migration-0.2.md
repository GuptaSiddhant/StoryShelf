# Migrating to 0.2.0

The 0.2.0 restructure keeps every published entrypoint working, with three
narrow exceptions below. Runtime behavior is unchanged.

## Unchanged (no action)

- `@storyshelf/core` — `createShelfRouter` and all adapter/option types.
- `@storyshelf/core/schema` — still exports every table handle, row type, and the
  `schema` object (now re-exported from `schema/` internally).
- `@storyshelf/core/ddl`, `/types`, `/models/*`, `/adapter/*` — same exports
  (plus the new `core/adapter/git-host/comments` entry).
- `createSqliteDatabase`, `createTursoDatabase`, `gitHubHost`, `gitLabHost`,
  CLI commands and flags — same signatures (commands gained an optional `cwd`).

## Changed

### 1. Barrel is router-only

`@storyshelf/core` now exports `createShelfRouter` plus `ShelfOptions` /
`ShelfConfig` / `UIConfig` / `BrandTheme` / `ShelfApp` / `ShelfContext` — nothing
else. Every other value moved to a subpath (new entries: `core/logger`,
`core/capture`, `core/adapter/capture-queue`, `core/paths`, `core/urls`,
`core/diff`):

```ts
// Before
import { createShelfLogger, executeCaptureJob, InMemoryCaptureQueue, StorybookAdapter } from "@storyshelf/core";
import type { CaptureQueue } from "@storyshelf/core";
import type { Logger } from "@storyshelf/core/types";
// After
import { createShelfRouter } from "@storyshelf/core";
import { createShelfLogger, type Logger } from "@storyshelf/core/logger";
import { executeCaptureJob, InMemoryCaptureQueue, StorybookAdapter } from "@storyshelf/core/capture";
import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
```

Adapter interfaces (`DatabaseAdapter`, `StorageAdapter`, `CaptureRunner`,
`AuthAdapter`, `GitHostProvider`, …) moved to their `core/adapter/*` entries;
`CheckStatus` / `GitHost*` live under `core/adapter/git-host`. Row types stay
under `core/schema` (or per-entity `core/schema/*` inside the repo); models
under `core/models/*`. Internal tooling (`store`, `middleware`, `retention`,
page components, `ulid`) has no public entry at all.

### 2. Row types no longer re-exported from model modules

```ts
// Before
import type { Build } from "@storyshelf/core/models/build";
// After (pick one)
import type { Build } from "@storyshelf/core/schema/build";
import type { Build } from "@storyshelf/core"; // barrel now includes models-adjacent types via schema
```

Model modules export only their own API (`*Model` classes, `*CreateInput`,
`isPublicBuild`). The row types live with their tables in `schema/<entity>.ts`
and are re-exported from the barrel and the `core/schema` entry.

### 3. `src/schema-tables.ts` and `src/schema.ts` deleted (source imports only)

Only affects consumers importing TypeScript source directly (the `source` export
condition) via deep paths. Published `dist` consumers are unaffected.

```ts
// Before
import { builds } from "@storyshelf/core/src/schema-tables.ts";
// After
import { builds } from "@storyshelf/core/schema/build";
```

### 4. `findMrIid` host parameter is optional

```ts
// Before
findMrIid({ host: undefined, owner, repo, token, sha });
// After
findMrIid({ owner, repo, token, sha });
```

Passing an explicit variable (as `git-gitlab` internals do) still compiles; only
the `undefined` literal at the call site is affected.

## Evaluated and declined

- **P-S5 follow-up (inline `UrlBuilder`, move status enums):** `createUrlBuilder`
  has no internal callers and a clean 45-line surface; `types.ts` is a cohesive
  status/role enum module. Churn outweighed benefit — no change in 0.2.0.
