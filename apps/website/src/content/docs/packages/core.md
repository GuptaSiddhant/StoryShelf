---
title: "@storyshelf/core"
description: StoryShelf's domain layer — adapters, models, capture pipeline, and review engine (no HTTP).
---

`@storyshelf/core` is the domain layer at the center of StoryShelf. It provides adapter contracts, models, the server-side capture pipeline, pixel diff engine, and retention jobs — with no HTTP dependency, so queue workers and remote runners import it without pulling a server. The HTTP server lives in [@storyshelf/app](../router/).

## Install

```sh
nub add @storyshelf/core
```

[![JSR](https://jsr.io/badges/@storyshelf/core)](https://jsr.io/@storyshelf/core) [![JSR Score](https://jsr.io/badges/@storyshelf/core/score)](https://jsr.io/@storyshelf/core)

- [npm package](https://www.npmjs.com/package/@storyshelf/core) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/core) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/core/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/core) — package directory on `main`.

## Compose a server

Pass a database and storage adapter to `createShelfApp` from `@storyshelf/app` (see the [router package](../router/)). Capture, authentication, git providers, logging, branding, and server behavior are optional.

```ts
import { createShelfApp } from "@storyshelf/app";
import { gitHubHost } from "@storyshelf/git-github";

const app = createShelfApp({
  database,
  storage,
  captureRunner,
  gitHosts: [gitHubHost],
  auth,
  config: { secret, captureConcurrency: 2, purgeTtlDays: 30, branchTtlDays: 30, branchGcIntervalMs: 86_400_000 },
});

serve({ fetch: app.fetch, port: 3000 });
```

Adapter `setup` hooks kick off in the background when the router is created. Await them before serving for fail-fast startup (or let the first request gate on settlement), and tear down adapters on shutdown:

```ts
await app.lifecycle.setup();

const server = serve({ fetch: app.fetch, port: 3000 });
process.on("SIGTERM", () => {
  app.lifecycle.teardown().then(() => server.close()).catch(() => {});
});
```

## Main APIs

The barrel (`@storyshelf/core`) exports only the router and its types
(`createShelfApp`, `ShelfOptions`, `ShelfConfig`, `UIConfig`, `ShelfApp`).
Everything else lives under a subpath:

- `executeCaptureJob({ buildId, reqId }, deps)` (`core/capture`) — the capture **orchestrator**: loads the build, marks it `capturing`, extracts the uploaded archive, discovers stories, delegates rendering to a pure `CaptureRunner`, and persists. Wired into the `Queue` when `capture` is supplied.
- `persistCapture(context)` (`core/capture`) writes screenshots, diffs them against baselines, and finalizes a build from a renderer's captures.
- `diffImages(baseline, current, options)` (`core/diff`) performs the pixel-level comparison.
- `InMemoryCaptureQueue` (`core/capture`) manages capture concurrency and job status.
- `createUrlBuilder(baseUrl, publishedBaseDomain?)` (`core/urls`) builds application and published Storybook URLs.

## Adapter contracts

The router requires a `DatabaseAdapter` and `StorageAdapter`. `AuthAdapter`, `CaptureRunner`, a pino `Logger`, and git providers are optional. All adapters are constructor-injected, so each deployment can choose its own database, storage, and authentication implementation. Logging uses pino (`createShelfLogger`), with optional transports for hosted observability platforms. Every adapter **instance** exposes mandatory `metadata: { name, version, description, kind, category }` (`version` injected via `__PKG_VERSION__` at build; `category` is the family — `database`, `storage`, `auth`, `capture-runner`, `capture-queue`, `git-host` — while `kind` stays an open string so third-party implementations are never blocked) plus an optional `lifecycle` object for setup, teardown, and probes (all or nothing — a present `lifecycle` implements `setup`, `teardown`, and `health`). Adapter-specific extensions live in the same metadata object (git adds `schema` + `logo`).

Git integration is a `GitHost` pair:

- **`GitHostProvider`** — descriptor registered at startup in `ShelfOptions.gitHosts` (array, keep `[]` for heterogeneous hosts). Carries `metadata: { kind:"github", name, version, description, logo, schema }` (zod) and `create({config, token, logger})→GitHostAdapter`.
- **`GitHostAdapter`** — runtime per-project instance exposing `setStatus(context, gitSha, status, url)` plus optional `isMerged({sha, branch})` (skip capture if PR already merged) and `upsertComment({sha, url, markdown})` (one comment per build, updated via `<!-- storyshelf:<url> -->` marker).

Packages that implement `GitHostProvider` (e.g. `@storyshelf/git-github` `gitHubHost`) are wired in alongside the router — see [the git-github package](../git-github/).

`ShelfConfig` supports a session secret, published Storybook base domain, capture concurrency, capture viewports, a capture scratch directory (`scratchDir`, required when `capture` is enabled), purge TTL (`purgeTtlDays`), branch GC TTL (`branchTtlDays` 30, `null`=disabled) + interval (`branchGcIntervalMs` 86_400_000 daily), and an optional `adapters` snapshot (`{ [key]: AdapterMetadata }`) auto-populated from each adapter's `metadata` for introspection. The `secret` is also used to encrypt git-provider tokens at rest. `UIConfig` controls the name, logo, favicon, and light/dark brand themes.

Choose the default adapters in [deployment](../../guides/deployment/) or see the [CLI guide](../../guides/cli/) for the packaged server entry point.
