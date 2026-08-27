# @storyshelf/core

The heart of StoryShelf: the Hono router, adapter interfaces, models, capture pipeline, diff engine, and retention logic. Compose pluggable adapters into a complete self-hosted visual testing server.

## Install

```sh
nub add @storyshelf/core
```

or

```sh
npm install @storyshelf/core
```

## Quick start

```ts
import { createShelfRouter } from "@storyshelf/core";

const app = createShelfRouter({
  database,                 // DatabaseAdapter
  storage,                  // StorageAdapter
  capture,                  // CaptureRunner (optional)
  auth,                     // AuthAdapter (optional)
  status,                   // StatusAdapter (optional)
  logger,                   // LoggerAdapter (optional)
  ui: { name: "My Shelf" }, // UIConfig (optional)
  config: { captureConcurrency: 2, purgeTtlDays: 30 }, // ShelfConfig (optional)
});

// The returned app is a Hono instance; serve it with any Hono adapter.
serve({ fetch: app.fetch, port: 3000 });
```

## API

### `createShelfRouter(options: ShelfOptions): Hono`

Assembles the router from the provided adapters. `ShelfOptions`:

| Option | Type | Description |
| ------ | ---- | ----------- |
| `database` | `DatabaseAdapter` | **Required.** Data access. |
| `storage` | `StorageAdapter` | **Required.** Blob storage for screenshots, diffs, storybook archives. |
| `capture` | `CaptureRunner` | Optional. Enables the async capture queue. |
| `auth` | `AuthAdapter` | Optional. Enables auth and the login UI. |
| `status` | `StatusAdapter` | Optional. Reports CI status checks. |
| `logger` | `LoggerAdapter` | Optional. Defaults to `console`. |
| `ui` | `UIConfig` | Optional. UI branding. |
| `config` | `ShelfConfig` | Optional. Server behavior. |

### `ShelfConfig`

```ts
interface ShelfConfig {
  secret?: string;              // session signing secret
  publishedBaseDomain?: string; // for published storybook URLs
  captureConcurrency?: number;  // concurrent capture jobs (default 2)
  purgeTtlDays?: number;        // purge builds older than N days
  viewports?: Viewport[];       // capture viewports
}
```

### `UIConfig`

```ts
interface UIConfig {
  name?: string;
  logo?: string;
  favicon?: string;
  lightTheme?: BrandTheme;
  darkTheme?: BrandTheme;
}
```

### Adapter interfaces

All adapters are constructor-injected (no AsyncLocalStorage). See `docs/architecture.md` for the entity model and workflow.

- `DatabaseAdapter` — `insert`, `update`, `get`, `remove`, `list`, `count`, `all`, `migrate`, `close`. Also exports `ListOptions`.
- `StorageAdapter` — `read`, `write`, `delete`, `exists`, `list(prefix)`.
- `AuthAdapter` — `check(request)`, `createSession(user)`, `destroySession(sessionId)`, optional `handleCallback(callback)`. Also exports `AuthUser`, `AuthCallback`, and the shared `SESSION_COOKIE`.
- `CaptureRunner` — `run(buildId)`, `cancel(buildId)`. Also exports `JobStatus`.
- `StatusAdapter` — `setStatus(context, gitSha, status, url)`. Also exports `CheckStatus`.
- `LoggerAdapter` — `log`, `error`, optional `debug`.

### Capture, diff, and retention

- `runCapture(ctx: CaptureContext)` — server-side capture pipeline (discover stories, render, diff against baseline, finalize). Also exports `CaptureContext`, `RenderStory`, and the `StorySourceAdapter`/`StoryEntry`/`Viewport` types.
- `StorybookAdapter` — reads a built Storybook's `index.json`/`stories.json`.
- `diffImages(baseline: Buffer, current: Buffer, options: DiffOptions): DiffResult` — pixelmatch-based diff. Also exports `DiffOptions`, `DiffResult`.
- `Queue` — `new Queue(concurrency)`, with `run`, `status`, `active`, `recent`.
- `Retention` — `new Retention(db, storage)`, with `purge(project, { ttlDays, keepLatestPerBranch })`.

### Helpers

- `createUrlBuilder(baseUrl, publishedBaseDomain?)` — type-safe URL builder. Also exports `UrlBuilder`.
- `ulid`, `slugify`.
- Path helpers: `screenshotPath`, `diffPath`, `baselinePath`, `storybookDir`, `storybookZipPath`.
- `RenderedContent` type for the server-rendered UI.

## How it fits in

`core` is the framework everything else plugs into: `createShelfRouter` takes database, storage, capture, and auth adapters (from the `db-*`, `storage-*`, and `auth-*` packages) and produces a complete Hono server. The web UI is server-rendered `hono/jsx` + HTMX, and custom UIs can consume the JSON API under `/api/v1`.

See `docs/architecture.md` and the ADRs in `docs/adr/`.
