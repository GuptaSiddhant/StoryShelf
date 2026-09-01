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

Pass a database and storage adapter to `createShelfRouter`. Capture, authentication, git providers, logging, branding, and server behavior are optional.

```ts
import { createShelfRouter } from "@storyshelf/core";
import { githubAdapter } from "@storyshelf/git-github";

const app = createShelfRouter({
  database,
  storage,
  captureRunner,
  gitProviders: [githubAdapter],
  auth,
  config: { secret, captureConcurrency: 2, purgeTtlDays: 30 },
});

serve({ fetch: app.fetch, port: 3000 });
```

## Main APIs

- `createShelfRouter(options)` returns a Hono application.
- `executeCaptureJob({ buildId, reqId }, deps)` — the capture **orchestrator**: loads the build, marks it `capturing`, extracts the uploaded archive, discovers stories, delegates rendering to a pure `CaptureRunner`, and persists. Wired into the `Queue` when `capture` is supplied.
- `persistCapture(context)` writes screenshots, diffs them against baselines, and finalizes a build from a renderer's captures.
- `diffImages(baseline, current, options)` performs the pixel-level comparison.
- `Queue` manages capture concurrency and job status.
- `Retention` purges expired builds and their stored files.
- `createUrlBuilder(baseUrl, publishedBaseDomain?)` builds application and published Storybook URLs.

## Adapter contracts

The router requires a `DatabaseAdapter` and `StorageAdapter`. `AuthAdapter`, `CaptureRunner`, a pino `Logger`, and git providers are optional. All adapters are constructor-injected, so each deployment can choose its own database, storage, and authentication implementation. Logging uses pino (`createShelfLogger`), with optional transports for hosted observability platforms. Every adapter **instance** exposes `metadata: { name, version, description, kind }` (`version` injected via `__PKG_VERSION__` at build); adapter-specific extensions live in the same object (git adds `schema` + `logo`).

Git integration is a single contract:

- **`GitAdapter`** — registered at startup in `ShelfOptions.gitProviders` (array). Carries `metadata: { kind:"github", name, version, description, logo, schema }` (zod schema for per-project config) and `withConfig({config, token, logger})→GitAdapter` + `setStatus(context, gitSha, status, url)`. The server validates each project's saved config against `metadata.schema`, decrypts its token, and calls `withConfig` per build (`pending` → `success`/`failure`).

Packages that implement `GitAdapter` (e.g. `@storyshelf/git-github` `githubAdapter`) are wired in alongside the router — see [the git-github package](../git-github/).

`ShelfConfig` supports a session secret, published Storybook base domain, capture concurrency, capture viewports, a capture scratch directory (`scratchDir`, required when `capture` is enabled), purge TTL, and an optional `adapters` snapshot (`{ [key]: AdapterMetadata }`) auto-populated from each adapter's `metadata` for introspection. The `secret` is also used to encrypt git-provider tokens at rest. `UIConfig` controls the name, logo, favicon, and light/dark brand themes.

Choose the default adapters in [deployment](../../guides/deployment/) or see the [CLI guide](../../guides/cli/) for the packaged server entry point.
