# ADR 0001: Architecture and Conventions

## Status

Accepted

Supersedes (archived): ADR 0001, 0005, 0007, 0016, 0018, 0019

## Context

StoryShelf is a self-hosted visual testing platform for Storybook: capture screenshots, diff them
against baselines, review the diffs, approve or reject. It must run on one container with local
storage, and also on cloud databases and object stores, without the core logic changing. Several
concerns (storage, database, auth, capture, git hosts, notifications) must be swappable
independently, models must be testable without ambient state, and the HTTP layer must not leak into
code that only needs the domain.

The product grew out of a hosting-and-comparison tool (StoryBooker). That tool's data model, UI and
CLI were built around uploading a zip and showing builds side by side, with models coupled to
`AsyncLocalStorage` and a user-defined shell-job compute system. Visual testing needs a different
data model, UI shape and capture pipeline, so StoryShelf is a from-scratch codebase that keeps only
the architectural patterns worth keeping: adapter composition, a type-safe URL builder (`linkRoute()`)
and an HTMX page shell.

## Decision

### 1. Adapter composition with constructor injection

`createShelfApp` takes a bag of independent adapters. Each adapter is a plain TypeScript interface;
provider packages export factories that return implementations.

```typescript
interface ShelfOptions {
  database: DatabaseAdapter;
  storage: StorageAdapter;
  testing?: TestingOptions; // absent = Storybook hosting only (see ADR 0006)
  auth?: AuthAdapter;
  logger?: LoggerAdapter;
  ui?: UIConfig; // brand identity: name, logo, favicon, theme tokens (not an adapter)
  config?: ShelfConfig;
}
```

Core code never imports a concrete implementation. Models receive their adapters as constructor
arguments (`new BuildsModel(db, storage)`); there is no `AsyncLocalStorage` lookup inside a model.
The per-request store exists for router handlers only. Adapter interfaces are designed carefully
because changing one is a breaking change; the concrete options of each concern are decided in its
own ADR (database: ADR 0002, storage: ADR 0003, capture and testing: ADR 0004 and ADR 0006).

### 2. Core is the domain, app is the HTTP layer

- **`@storyshelf/core`** holds the domain: adapter interfaces, models, schema, DDL, types, the
  capture pipeline and queue, retention, diff, config, logger, URL builder and shared utilities.
  Its barrel is domain-only and never imports Hono.
- **`@storyshelf/app`** holds `createShelfApp` (with `ShelfApp`, `ShelfContext`, `ShelfLifecycle`),
  routers, pages, UI, middleware, the request store, vendored assets and OpenAPI generation. Pages
  and routers need each other, so the UI is not a third package.
- App code imports core only through granular subpaths (`core/adapter/*`, `core/models`,
  `core/capture`, `core/schema`, `core/config`, `core/retention`, `core/utils`, ...), never the
  core barrel. `core/test-helpers` is a published subpath so out-of-tree adapters can run contract
  tests against in-memory fakes.
- `schema/index.ts` re-exports narrow table handles so generic adapters keep type inference.
  `app` has no dependency on a concrete database package; it reaches tables through
  `DatabaseAdapter.tables`.
- Server assembly (dev server, Fly app, the generated server of decision 5) imports
  `createShelfApp` from `@storyshelf/app`.

### 3. Storybook only

The product supports Storybook as its single component explorer. Capture discovers stories
through a `StorySourceAdapter` so another explorer can be added without changing the pipeline:

```typescript
interface StorySourceAdapter {
  name: string;
  discover(source: string): Promise<StoryEntry[]>;
  buildUrl(baseUrl: string, storyId: string): string;
  screenshotSelector?: string;
  waitForReady?(page: Page): Promise<void>;
}
```

The built-in Storybook source sets `screenshotSelector` to `#storybook-root` and leaves
`waitForReady` undefined, so capture waits on the selector. Ladle (same CSF format, nearly the same
`index.json`), Histoire (different format and URLs) and plain URL lists are possible later sources
and are not scheduled.

### 4. Conventions that are architectural

- **IDs** are ULIDs everywhere: sortable, collision-resistant, URL-safe.
- **Timestamps** are ISO-8601 strings in the database.
- **API prefix:** every JSON endpoint lives under `/api/v1`; HTML pages live at `/`.
- **URLs** are built with a type-safe `linkRoute()` builder.
- **Outbound HTTP** goes through one shared helper in core (decision 6); client libraries such as
  `ky` or `ofetch` are not added.
- **Single production owner per third-party dependency:** a runtime dependency is listed in exactly
  one package's `dependencies`; other packages use `devDependencies` for tests and import types
  through the owner.
- **Tests:** every model, router and adapter has tests; the default suite is hermetic (no browser),
  and the capture pipeline is covered by a gated integration suite.

### 5. Servers are scaffolded, not packaged

There is no universal server package. `storyshelf server init` in the CLI asks which database,
storage, auth and git provider to use and generates `server.ts` and `package.json` with the right
imports and dependencies. The user owns the generated file and edits it freely; the project
maintains templates, not adapter combinations. Existing CLI commands (`init`, `upload`, `retry`,
`purge`) are unaffected. The CLI uses `commander` for parsing and `prompts` for the interactive
selection of `server init` only. The scaffold generates only the single-deployable shape of ADR
0006: it has no worker scaffolding and no queue provisioning.

```typescript
// server.ts (generated)
import { serve } from "@hono/node-server";
import { createShelfApp } from "@storyshelf/app";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

const database = createSqliteDatabase("./data/shelf.db");
const storage = createLocalStorage("./data");
const runner = createPlaywrightCaptureRunner();

const app = createShelfApp({ database, storage, testing: { runner } });
serve({ fetch: app.fetch, port: 3000 });
```

### 6. One HTTP helper for outbound calls

`@storyshelf/core/utils` exports `httpJson<T>(url, options?)`, `HttpError` (status and a body
snippet) and `HttpRequestOptions` (`method`, `headers`, `json`, `timeoutMs` default 30 s via
`AbortSignal.timeout`, `retries` default 3 attempts).

- A non-2xx response throws `HttpError`.
- Only network failures, 429 and 502/503/504 are retried, never other 4xx. `Retry-After` is
  honoured (capped at 30 s), otherwise backoff is 1 s, 2 s, 4 s. Each attempt is logged at debug
  level with structured fields. There are no hooks or interceptors.
- Git host packages and the CLI use it. Provider-specific URL and auth building stays in each
  package. Callers that must fail fast (existence probes) pass fewer retries or catch and degrade.

## Consequences

**Positive**

- Backends swap by changing one adapter; models test with in-memory fakes and no store mocking.
- Workers, runners and adapter packages depend on core alone, with no Hono, JSX or page tree in
  their bundles.
- Users own their server entry point; new adapters need no change to a server package.
- All outbound HTTP shares one tested implementation with timeouts and rate-limit resilience.

**Negative**

- One more layer of indirection, and adapter interfaces are costly to change.
- A change that crosses the model/page boundary touches two packages (fixed-version releases keep
  them in lockstep, so the cost is review overhead, not versioning).
- Scaffold templates need maintenance as adapters are added, and the CLI carries two parsing
  dependencies.
- Teams using Ladle or Histoire are not served until another story source exists.
- The helper's retry budget means slow failures take seconds.

## Alternatives rejected

| Alternative                                                 | Why rejected                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Adapters resolved through `AsyncLocalStorage` inside models | Models become untestable without mocking the store                                      |
| Iterating on the predecessor codebase                       | Wrong data model, UI and CLI for visual testing; low test coverage; untested cloud code |
| Config-driven server package                                | Combinatorial adapter matrix and conditional imports                                    |
| One server package per deployment target                    | Maintenance scales with adapter count                                                   |
| Recipe docs only                                            | No one-command setup; users copy and paste                                              |
| Collapsing zero-dependency adapters into core               | Grows the bundle that runners and workers must keep small                               |
| A separate router-without-UI package                        | Every HTML route needs the pages, so it would have no consumer                          |
| `ky` / `ofetch` for outbound HTTP                           | About 120 lines of helper do not justify a third-party dependency                       |
