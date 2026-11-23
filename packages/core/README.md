# @storyshelf/core

The domain layer of StoryShelf: adapter interfaces, models, capture pipeline, diff engine, and retention logic — with no HTTP dependency, so the capture consumer imports it without pulling a server. The Hono router lives in `@storyshelf/app`. Compose pluggable adapters into a complete self-hosted visual testing server.

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
import { createShelfApp } from "@storyshelf/app";

const app = createShelfApp({
  database, // DatabaseAdapter
  storage, // StorageAdapter
  testing: { runner: captureRunner, concurrency: 2, compare: { threads: 2 } }, // capture pipeline + screenshot comparison (optional; absent = Storybook hosting only)
  auth, // Auth from @storyshelf/auth (optional)
  notifications: { notifiers: [...chatNotifiers, ...gitNotifiers] }, // NotifierProvider[]: chat, email and git (optional)
  logger, // pino Logger (optional; built internally if omitted)
  ui: { name: "My Shelf" }, // UIConfig (optional)
  config: {
    purgeTtlDays: 30,
    branchTtlDays: 30,
    branchGcIntervalMs: 86_400_000,
  }, // ShelfConfig (optional)
});

// The returned app is a Hono instance; serve it with any Hono adapter.
serve({ fetch: app.fetch, port: 3000 });
```

Adapter `setup` hooks kick off in the background when the router is created. Await them before serving for fail-fast startup (or let the first request gate on settlement), and tear down adapters on shutdown:

```ts
await app.lifecycle.setup();

const server = serve({ fetch: app.fetch, port: 3000 });
process.on("SIGTERM", () => {
  app.lifecycle
    .teardown()
    .then(() => server.close())
    .catch(() => {});
});
```

## API

### `createShelfApp(options: ShelfOptions): Hono`

Assembles the router from the provided adapters. `ShelfOptions`:

| Option            | Type                                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database`        | `DatabaseAdapter`                             | **Required.** Data access.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `storage`         | `StorageAdapter`                              | **Required.** Blob storage for screenshots, diffs, storybook archives.                                                                                                                                                                                                                                                                                                                                                                    |
| `testing`         | `{ runner, concurrency?, compare?, images? }` | Optional. Enables the async capture pipeline: `runner` (pure renderer; required, `testing: {}` throws; captures queue on the database), `concurrency` (jobs at once; default 2 on hosts with ≥ 2 CPUs and ≥ 3 GB, otherwise 1), `retries` (default 2). Absent means Storybook hosting only. `workerEntry` runs captures in a forked child the app pushes jobs to (`runCaptureChild`); `mode` is `auto` (default), `in-process` or `fork`. |
| `testing.compare` | `{ threads? }`                                | Optional. Worker threads for pixel diffs (default CPU count − 1; `0` = main thread). Also serves the re-diff endpoint. Overrides `SHELF_DIFF_WORKERS`.                                                                                                                                                                                                                                                                                    |
| `notifications`   | `{ notifiers?, emailSender?, config? }`       | Optional. `notifiers` (Slack/Teams/email providers and the GitHub/GitLab git providers built into core), `emailSender` (transport whose lifecycle hooks run with the app's), `config` (`fromEmail`, `fromName`, `footerText`, `slackUsername`).                                                                                                                                                                                           |
| `auth`            | `Auth` (`@storyshelf/auth`)                   | Optional. Enables auth and the login UI.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `logger`          | `Logger` (pino)                               | Optional. Shared logger. Construct a fallback via `createShelfLogger()`.                                                                                                                                                                                                                                                                                                                                                                  |
| `ui`              | `UIConfig`                                    | Optional. UI branding.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `config`          | `ShelfConfig`                                 | Optional. Server behavior.                                                                                                                                                                                                                                                                                                                                                                                                                |

### `ShelfConfig`

```ts
interface ShelfConfig {
  secret?: string; // session signing secret
  publishedBaseDomain?: string; // for published storybook URLs
  scratchDir?: string; // working directory for publishing and capture (default: <os.tmpdir()>/storyshelf)
  purgeTtlDays?: number; // purge builds older than N days
  branchTtlDays?: number | null; // branch baseline TTL, days; null disables GC (default 30)
  branchGcIntervalMs?: number; // branch GC interval, ms; daily via interval clock (default 86_400_000)
  maxUploadBytes?: number; // single-zip upload cap (default 1 GiB)
  maxInlineUnzipSize?: number; // largest zip extracted inline at upload (default 50 MB; 0 = always a publish job)
  maxZipEntries?: number; // most entries a zip may hold (default 50 000)
  maxUnzippedBytes?: number; // most uncompressed bytes a zip may expand to (default 2 GiB)
  viewports?: Viewport[]; // capture viewports
}
```

### `UIConfig`

```ts
interface UIConfig {
  name?: string;
  logo?: string;
  favicon?: string; // deprecated: ignored, the app serves its own mark
  lightTheme?: BrandTheme;
  darkTheme?: BrandTheme;
}
```

### Adapter interfaces

All adapters are constructor-injected (no AsyncLocalStorage). See `docs/architecture.md` for the entity model and workflow. Import each from its subpath — the barrel (`@storyshelf/core`) exports only the router and its types.

- `DatabaseAdapter` (`core/adapter/database`) — `insert`, `update`, `get`, `remove`, `list`, `count`, `all`, `migrate`, `close`. Also exports `ListOptions` and the `createDrizzleAdapter` factory.
- `StorageAdapter` (`core/adapter/storage`) — `read`, `write`, `delete`, `exists`, `list(prefix)`.
- `Auth` (`@storyshelf/auth`) — the shelf authentication singleton: `check(request)`, `handler` (mount at `/api/auth/*`), `loginMethods()`, invites, sessions, passkeys. `AuthUser` and the shared `SESSION_COOKIE` live in `core/types`.
- `CaptureRunner` (`core/adapter/capture-runner`) — a **pure capture renderer**: `render(input) => RenderResult`, `cancel(buildId)`. Also exports `RenderedSnapshot`, `RenderResult`, `StoryEntry`, `StorySourceAdapter`, `Viewport`.
- `CaptureQueue` (`core/adapter/capture-queue`) — `enqueue({ buildId, reqId? })`, plus `status`, `active`, `recent`. Also exports `CaptureJob`, `QueueEntry`, `JobStatus`.
- `DesignProvider` / `DesignClient` (`core/adapter/design`) — validate design links and fetch file metadata and rendered previews from a design tool. The Figma provider is built into core; also exports `parseDesignUrl` and `InvalidDesignUrlError`.
- `NotifierProvider` / `NotifierAdapter` (`core/adapter/notifier`) — one family with two delivery kinds: `message` providers (built in) `send` a formatted message; `state` providers (built in: GitHub, GitLab) `setState` a commit status or pull-request comment, idempotently. Also exports `emitNotifications`, `statusesForBuild` (the pure build-to-statuses function), `writeBuildState`, `isStateProvider`, `NotifierState` and `NotifierStateTarget`; `core/build-state` exports the `notify` job (`createBuildStatePublisher`, `createNotifyHandler`, `createNotifyEnqueuer`).

### Logging

`core` uses **pino** for structured JSON logging. `createShelfLogger({ level, transports, env })` (from `core/logger`) builds a logger writing to stdout by default, with optional extra pino worker transports (Sentry, PostHog, Datadog, GCP, OTEL collector, etc.). Pass the resulting `Logger` to `createShelfApp({ logger })` (or construct it at your composition root) so request and background logs share one stream. The capture orchestrator derives a `reqId`-scoped child for background capture work, correlating each capture back to the triggering HTTP request. See ADR 0014.

### Capture, diff, and retention

Import from the subpaths — `core/capture` (testing only), `core/jobs`, `core/publish`, `core/build-state`, `core/catalog` and the model entries — never from the barrel:

- `executeCaptureJob({ buildId, reqId }, deps)` (`core/capture`) — the capture **orchestrator**: loads the build, marks it `capturing`, extracts the uploaded archive into `scratchDir`, discovers stories, delegates rendering to a pure `CaptureRunner`, and persists. `createShelfApp` wires it into a `CaptureQueue` when `testing` is supplied (and requires `ShelfConfig.scratchDir`). Also exports `CaptureJobOptions`.
- `persistCapture(ctx: CaptureContext)` (`core/capture`) — writes screenshots, diffs against the branch baseline, creates snapshots, and finalizes a build from a pure renderer's `captures`. Also exports `CaptureContext`.
- `StorybookAdapter` (`core/capture`; a runner takes it from `core/adapter/capture-runner`) — reads a built Storybook's `index.json`/`stories.json`.
- `createCatalogLoader({ db, storage })`, `createCatalogHook(loader)`, `catalogueBuild`, `parseStorybookIndex`, `groupComponents`, `componentBuildHistory` (`core/catalog`) — the Storybook catalog of a published build (ADR 0006, decision 9): `catalog.json` plus one `build_components` row per component, written by the `afterPublish` hook, loaded through an in-process LRU and catalogued lazily for older builds. `BuildComponentModel` (`core/models`) reads and replaces the rows.
- `BuildReviewModel`, `deriveReviewStatus`, `latestVerdicts` (`core/models`) — build-level review (ADR 0013, decision 3): `build_reviews` rows (a reviewer's newest row is their verdict) and the pure rule that turns them into `approved`, `rejected` or `pending` when `testing` is off and review is on. `publishVerdict` (`core/publish`) takes the project's review switch: a published non-default build is accepted when review is off.
- `computeChangeset`, `changesetOf`, `findChangesetBaseline`, `acceptPendingWithoutWork` (`core/models`) — the catalog changeset of a build (components added, removed and changed against its baseline build, ADR 0013 decision 8) and the pass that accepts a project's idle pending builds when review is turned off. `Retention.purge` (`core/retention`) also removes `pending` builds idle past the retention window.
- `createDatabaseCaptureQueue(db, options)` (`core/jobs`) — a `PollableCaptureQueue` on the app's own database (`capture_jobs`; ADR 0006): per-attempt claim rows fence concurrent instances, leases follow progress, retries back off, `cancel(jobId | buildId)` reaches the holder within 5 s. Not wired into the app yet. `startPollLoop` and `keepJobLease` are the consumer-side helpers.
- `createCaptureConsumer({ queue, handlers, config })` (`core/jobs`) — the consumer loop over any `PollableCaptureQueue`: a handler per job kind (`createCaptureHandler` from `core/capture` runs the core dispatch for `capture`; each handler's `prepare` runs before the first poll), a slot before each poll, retries with exponential backoff and the final-attempt rule, lease kept by progress, cancel and lease loss stop the run, `stop()` drains. `runCaptureChild` (forked capture) runs it over IPC.
- `ImageEngine`, `DiffOptions`, `DiffResult`, `DEFAULT_DIFF_OPTIONS` (`core/adapter/capture-runner`) — the image-engine contract a runner supplies as `CaptureRunner.images`; capture, rediff and triage evidence compare and downscale only through it. The engine itself (codecs, worker pool, pixelmatch) is `@storyshelf/runner/images`; core imports no image library (#1365).
- Models, schema, and row types back every entity; retention runs inside the router (`Retention.purge` for builds + `Retention.purgeStaleBranches` for branch GC via `retention-timer.ts` daily sweep). (Models are private implementation details with no public entry — reach row types via `core/schema`.)

### Helpers

- `createUrlBuilder(baseUrl, publishedBaseDomain?)` (`core/urls`) — type-safe URL builder. Also exports `UrlBuilder`.
- Path helpers (`core/paths`): `screenshotPath`, `diffPath`, `baselinePath`, `storybookDir`, `storybookZipPath`.

## How it fits in

`core` is the framework everything else plugs into: `createShelfApp` takes database, storage, capture, and auth adapters (from the `@storyshelf/db`, `@storyshelf/storage` and `@storyshelf/auth` packages) and produces a complete Hono server. The web UI is server-rendered `hono/jsx` + HTMX, and custom UIs can consume the JSON API under `/api/v1`.

See `docs/architecture.md` and the ADRs in `docs/adr/`.

## Deployment targets

The core router is runtime-agnostic (Web `Request`/`Response`, `fetch`, `crypto`, `URL`). The Node-specific piece is the capture consumer and its optional forked child, which need a long-lived Node server: that is what the `testing` option turns on, and the database is the queue (ADR 0006). Without `testing` an instance only hosts Storybooks and runs on serverless platforms too. You assemble a server for any platform — `npm create storyshelf` generates a scaffold with the adapters you choose:

| Platform                                                             | Database                                                | Storage                                                                            | `testing` (capture) | Server entry                      |
| -------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------- | --------------------------------- |
| **Vercel, AWS Lambda, Azure Functions**                              | `@storyshelf/db/sqlite/turso`                           | `@storyshelf/storage/s3`                                                           | No (hosting only)   | Hono + platform handler           |
| **Cloudflare Workers**                                               | `@storyshelf/db/sqlite/d1` or turso                     | `@storyshelf/storage/s3` (R2)                                                      | No (hosting only)   | Hono + Workers entry              |
| **Bun / Node (VPS, Fly, Railway, Render)**                           | `@storyshelf/db/sqlite` (+ `/sqlite/bun-sqlite` on Bun) | `core/storage/local` / `@storyshelf/storage/s3`                                    | Yes, database queue | `storyshelf-server serve`         |
| **Container platforms (ECS, Cloud Run, Container Apps, Kubernetes)** | `@storyshelf/db/postgres` / `/mysql`                    | `@storyshelf/storage/s3` / `@storyshelf/storage/gcs` / `@storyshelf/storage/azure` | Yes, database queue | `storyshelf server init` scaffold |

All clouds are equal — pick the adapters that match your infrastructure. See the **Deployment** guide for recipes including a minimal Turso + S3 example.
