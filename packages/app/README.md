# @storyshelf/app

The StoryShelf HTTP app: `createShelfApp()` composes database, storage, capture, auth, and notifier (chat, email, git) adapters (all from `@storyshelf/core`) into a complete Hono application — JSON API under `/api/v1` plus server-rendered HTML pages (hono/jsx + HTMX, no client framework).

## Quick start

```ts
import { createShelfApp } from "@storyshelf/app";

const app = createShelfApp({ database, storage, testing: { runner: captureRunner } });
// Leave `testing` out to host Storybooks only: createShelfApp({ database, storage })
await app.lifecycle.setup();

serve({ fetch: app.fetch, port: 3000 });
```

Adapter `init` hooks kick off in the background when the app is created. Await them before serving for fail-fast startup (or let the first request gate on settlement), and close adapters on shutdown:

```ts
await app.lifecycle.setup();

const server = serve({ fetch: app.fetch, port: 3000 });
process.on("SIGTERM", () => {
  app.lifecycle
    .close()
    .then(() => server.close())
    .catch(() => {});
});
```

## Logging

Three tiers, pick the shallowest that fits:

1. **Defaults** — omit `logger` and import nothing. The app creates its own instance; `LOG_LEVEL` env sets the level (`debug`, `info`, …; default `"info"`).
2. **Configured app** — `createShelfLogger` (re-exported from `@storyshelf/app`, canonical home `@storyshelf/core/logger`), pass it in, and read it back via `app.lifecycle.logger` for your own logs:

   ```ts
   import { createShelfLogger, createShelfApp } from "@storyshelf/app";

   const app = createShelfApp({ database, storage, logger: createShelfLogger() });
   await app.lifecycle.setup();
   const logger = app.lifecycle.logger;
   ```

3. **A process that only consumes jobs or runs forked capture** — import `createShelfLogger` from `@storyshelf/core/logger` directly, never the router barrel (it must not pull Hono).

## Health

Two-tier, neither gated by adapter init: `GET /api/v1/health` is open liveness for orchestrators; `POST /api/v1/health` is site-admin deep readiness with per-adapter states.

Choose the default adapters in [deployment](../../guides/deployment/) or see the [CLI guide](../../guides/cli/) for the packaged server entry point.

## How it fits in

`app` owns everything HTTP: `routers/`, `pages/`, `ui/`, `middleware/`, the request `store`, and vendored assets. All domain logic — adapter interfaces, models, schema, capture pipeline, retention, diff — lives in `@storyshelf/core` and is imported here through its granular subpaths (never the core barrel, which is now domain-only). The capture consumer and the forked capture child live in core too, so they pull zero HTTP modules.
