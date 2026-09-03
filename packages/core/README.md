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
  captureRunner,            // CaptureRunner (optional)
  auth,                    // AuthAdapter (optional)
  gitHosts,                // GitHostProvider[] (optional)
  logger,                  // pino Logger (optional; built internally if omitted)
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
| `captureRunner` | `CaptureRunner` | Optional. Enables the async capture pipeline (pure renderer). |
| `captureQueue` | `CaptureQueue` | Optional. Queue adapter; defaults to `InMemoryCaptureQueue`. |
| `auth` | `AuthAdapter` | Optional. Enables auth and the login UI. |
| `gitHosts` | `GitHostProvider[]` | Optional. Git-host adapters (GitHub/GitLab) for status checks, merge gates, PR comments. |
| `logger` | `Logger` (pino) | Optional. Shared logger. Construct a fallback via `createShelfLogger()`. |
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
- `CaptureRunner` — a **pure capture renderer**: `render(input) => RenderResult`, `cancel(buildId)`. Also exports `JobStatus`, `RenderedSnapshot`, `RenderResult`.
- `GitHostProvider` / `GitHostAdapter` — set commit status checks, detect merges, and upsert PR comments. Real providers ship in `@storyshelf/git-github` and `@storyshelf/git-gitlab`. Also exports `CheckStatus`.

### Logging

`core` uses **pino** for structured JSON logging. `createShelfLogger({ level, transports, env })` builds a logger writing to stdout by default, with optional extra pino worker transports (Sentry, PostHog, Datadog, GCP, OTEL collector, etc.). Pass the resulting `Logger` to `createShelfRouter({ logger })` (or construct it at your composition root) so request and background logs share one stream. The capture orchestrator derives a `reqId`-scoped child for background capture work, correlating each capture back to the triggering HTTP request. See ADR 0014.

### Capture, diff, and retention

- `executeCaptureJob({ buildId, reqId }, deps)` — the capture **orchestrator**: loads the build, marks it `capturing`, extracts the uploaded archive into `scratchDir`, discovers stories, delegates rendering to a pure `CaptureRunner`, and persists. `createShelfRouter` wires it into a `CaptureQueue` when `capture` is supplied (and requires `ShelfConfig.scratchDir`). Also exports `CaptureJobOptions`.
- `persistCapture(ctx: CaptureContext)` — writes screenshots, diffs against the branch baseline, creates snapshots, and finalizes a build from a pure renderer's `captures`. Also exports `CaptureContext` and the `StorySourceAdapter`/`StoryEntry`/`Viewport` types.
- `StorybookAdapter` — reads a built Storybook's `index.json`/`stories.json`.
- `diffImages(baseline: Buffer, current: Buffer, options: DiffOptions): DiffResult` — pixelmatch-based diff. Also exports `DiffOptions`, `DiffResult`.
- `CaptureQueue` — the **capture queue adapter**: `enqueue({ buildId, reqId? })`, plus `status`, `active`, `recent`. `enqueue` returns once a build is queued (async, "queued"); the job runs in a worker. Default is `InMemoryCaptureQueue` (in-process, concurrency-limited, for long-lived hosts); supply a remote queue with a separate worker for serverless. Also exports `CaptureJob`, `QueueEntry`, `JobStatus`.
- `Retention` — `new Retention(db, storage, logger?)`, with `purge(project, { ttlDays, keepLatestPerBranch })`.

### Helpers

- `createUrlBuilder(baseUrl, publishedBaseDomain?)` — type-safe URL builder. Also exports `UrlBuilder`.
- `ulid`, `slugify`.
- Path helpers: `screenshotPath`, `diffPath`, `baselinePath`, `storybookDir`, `storybookZipPath`.
- `RenderedContent` type for the server-rendered UI.

## How it fits in

`core` is the framework everything else plugs into: `createShelfRouter` takes database, storage, capture, and auth adapters (from the `db-*`, `storage-*`, and `auth-*` packages) and produces a complete Hono server. The web UI is server-rendered `hono/jsx` + HTMX, and custom UIs can consume the JSON API under `/api/v1`.

See `docs/architecture.md` and the ADRs in `docs/adr/`.

## Deployment targets

The core router is runtime-agnostic (Web `Request`/`Response`, `fetch`, `crypto`, `URL`). The only Node-specific piece is the in-process `InMemoryCaptureQueue`, which suits long-lived Node servers; serverless runtimes swap in a remote `CaptureQueue` (e.g. `@storyshelf/queue-sqs`) plus a separate worker. You assemble a server for any platform — `storyshelf server init` generates a scaffold with the adapters you choose:

| Platform | Database | Storage | Capture queue | Server entry |
|----------|----------|---------|---------------|--------------|
| **Vercel** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` (R2/S3) | Remote `CaptureQueue` + worker | Hono + `@hono/vercel-edge` |
| **Cloudflare Workers** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` (R2) | Workers Queues `CaptureQueue` | Hono + Workers entry |
| **Azure Functions** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` (Blob) | Azure Queues `CaptureQueue` | Hono + Azure handler |
| **AWS Lambda** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` | SQS `CaptureQueue` | Hono + Lambda handler |
| **Deno Deploy** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` | Custom `CaptureQueue` (Deno KV) | Hono + Deno entry |
| **Bun / Node (VPS, Fly, Railway, Render)** | `db-sqlite` / `db-turso` | `storage-local` / `storage-s3` | `InMemoryCaptureQueue` | `storyshelf-server serve` |

All clouds are equal — pick the adapters that match your infrastructure. See the **Deployment** guide for recipes including a minimal Turso + S3 + `InMemoryCaptureQueue` example.
