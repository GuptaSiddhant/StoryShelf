---
title: "@storyshelf/core"
description: Compose StoryShelf's server, adapters, capture pipeline, and review UI.
---

`@storyshelf/core` is the framework at the center of StoryShelf. It provides the Hono router, adapter contracts, models, server-side capture pipeline, pixel diff engine, retention jobs, and server-rendered UI.

## Install

```sh
nub add @storyshelf/core
```

## Compose a server

Pass a database and storage adapter to `createShelfRouter`. Capture, authentication, status checks, logging, branding, and server behavior are optional.

```ts
import { createShelfRouter } from "@storyshelf/core";

const app = createShelfRouter({
  database,
  storage,
  capture,
  auth,
  config: { captureConcurrency: 2, purgeTtlDays: 30 },
});

serve({ fetch: app.fetch, port: 3000 });
```

## Main APIs

- `createShelfRouter(options)` returns a Hono application.
- `runCapture(context)` discovers stories, renders them, diffs them against baselines, and finalizes a build.
- `diffImages(baseline, current, options)` performs the pixel-level comparison.
- `Queue` manages capture concurrency and job status.
- `Retention` purges expired builds and their stored files.
- `createUrlBuilder(baseUrl, publishedBaseDomain?)` builds application and published Storybook URLs.

## Adapter contracts

The router requires a `DatabaseAdapter` and `StorageAdapter`. `AuthAdapter`, `CaptureRunner`, `StatusAdapter`, and a pino `Logger` are optional. All adapters are constructor-injected, so each deployment can choose its own database, storage, and authentication implementation. Logging uses pino (`createShelfLogger`), with optional transports for hosted observability platforms.

`ShelfConfig` supports a session secret, published Storybook base domain, capture concurrency, purge TTL, and capture viewports. `UIConfig` controls the name, logo, favicon, and light/dark brand themes.

Choose the default adapters in [deployment](../../guides/deployment/) or see the [CLI guide](../../guides/cli/) for the packaged server entry point.
