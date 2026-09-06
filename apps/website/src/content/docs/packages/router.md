---
title: "@storyshelf/router"
description: StoryShelf's HTTP server — Hono router, API routes, and server-rendered UI over @storyshelf/core.
---

`@storyshelf/router` is the HTTP server for StoryShelf. `createShelfRouter()` composes database, storage, capture, auth, and git-host adapters (all from `@storyshelf/core`) into a Hono application: a JSON API under `/api/v1` plus server-rendered HTML pages (hono/jsx + HTMX, no client framework).

## Install

```sh
nub add @storyshelf/router
```

[![JSR](https://jsr.io/badges/@storyshelf/router)](https://jsr.io/@storyshelf/router) [![JSR Score](https://jsr.io/badges/@storyshelf/router/score)](https://jsr.io/@storyshelf/router)

- [npm package](https://www.npmjs.com/package/@storyshelf/router) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/router) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/router/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/router) — package directory on `main`.

## Compose a server

```ts
import { createShelfRouter } from "@storyshelf/router";

const app = createShelfRouter({ database, storage, captureRunner });
await app.lifecycle.init();

serve({ fetch: app.fetch, port: 3000 });
```

Adapter `init` hooks kick off in the background when the router is created. Await them before serving for fail-fast startup (or let the first request gate on settlement), and close adapters on shutdown:

```ts
await app.lifecycle.init();

const server = serve({ fetch: app.fetch, port: 3000 });
process.on("SIGTERM", () => {
  app.lifecycle.close().then(() => server.close()).catch(() => {});
});
```

## Main APIs

The barrel exports only the router and its types (`createShelfRouter`, `ShelfApp`, `ShelfRouter`, `ShelfContext`, `ShelfLifecycle`, plus the option types re-exported from core). Everything domain-level lives under `@storyshelf/core/*` subpaths.

## Health

Two-tier, neither gated by adapter init: `GET /api/v1/health` is open liveness for orchestrators; `POST /api/v1/health` is site-admin deep readiness with per-adapter states.

Choose the default adapters in [deployment](../../guides/deployment/) or see the [CLI guide](../../guides/cli/) for the packaged server entry point.
