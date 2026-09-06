# ADR 0018: Split Core (Domain) from Router (HTTP)

## Status

Accepted

## Context

`@storyshelf/core` grew into two things: a domain layer (adapter interfaces, models, schema, capture pipeline, retention, diff, config, logging) and an HTTP layer (`createShelfRouter`, routers, pages, middleware, request store, vendored assets). Remote capture workers (`queue-sqs` today, `runner-remote` tomorrow) need the domain — `executeCaptureJob`, models, adapter types — without pulling Hono, JSX, and the whole page tree into a worker bundle.

The layering was already approximated by convention: every adapter package imports `@storyshelf/core/*` subpaths, never the barrel, and no domain module imports from `routers/`, `pages/`, `ui/`, `middleware/`, or `store.ts` (verified by inspection; only two wiring tests crossed the boundary). The split makes the boundary structural instead of conventional.

The opposite direction was considered and rejected: #57 proposed collapsing zero-dependency adapters *into* core. Consolidation would grow the very bundle workers must avoid, so #57 is closed as superseded by this decision.

## Decision

1. **New `@storyshelf/router` package** (library, single `index` entry): `createShelfRouter` (`ShelfApp`, `ShelfRouter`, `ShelfContext`, `ShelfLifecycle`) plus the moved `routers/`, `pages/`, `ui/`, `middleware/`, `store.ts`, vendored assets, and the OpenAPI generation script. Internal relative layout is preserved so `routers→pages`, `pages→ui|store`, `middleware→store` imports resolve unchanged.
2. **`@storyshelf/core` keeps the domain**: `adapters/`, `models/`, `schema/`, `ddl.ts`, `types.ts`, `capture/` (orchestrator, pipeline, queue), `retention/`, `diff/`, `config.ts`, `logger.ts`, `urls.ts`, `utils/`; its barrel is domain-only (config/logger/types surface) and must never import Hono.
3. **Router imports core only through granular subpaths** (`core/adapter/*`, `core/models`, `core/capture`, `core/schema`, …), never the core barrel. New subpaths added for the split: `./config`, `./models`, `./retention`, `./utils`, `./test-helpers`, `./adapter/webhook-events`. `schema/index.ts` re-exports narrow table handles (replacing widened `AnySQLiteTable` aliases) so generic adapters keep inference through the barrel.
4. **UI stays in router** (no third package): per ADR 0012 the UI is fixed and server-rendered; every HTML route needs the pages, so a router-without-UI has no consumer.
5. **Server assembly moves**: dev-server, fly-app, and the CLI `server init` template import `createShelfRouter` from `@storyshelf/router`; adapter/logger imports are unchanged.

## Consequences

- Queue/remote workers depend on core alone: zero HTTP modules in worker bundles (demonstrated by the fly-app rolldown smoke passing against the split tree).
- Cross-layer changes (a model field consumed by a page) now touch two packages; fixed-version releases keep them in lockstep, so this is review overhead, not versioning overhead.
- `core/test-helpers` is a published subpath (in-memory fakes for out-of-tree adapter contract tests) rather than a duplicated copy.
- Follow-up fixed separately: `unzipper` added to the workspace public-hoist list after the fly-app smoke test caught it missing from the bundled server's runtime (pre-existing gap since streaming uploads, not caused by the split).
