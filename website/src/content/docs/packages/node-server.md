---
title: "@storyshelf/node-server"
description: The self-hosted StoryShelf server for long-lived Node hosts — review UI, SQLite, storage, and capture, assembled in one process.
---

`@storyshelf/node-server` provides the `storyshelf-server` binary: the self-hosted StoryShelf server **for long-lived Node hosts**. It is the **assembly point** — it wires `@storyshelf/core`, `@storyshelf/db-sqlite`, and `@storyshelf/storage-local`, serves the review UI, and injects a `CaptureRunner` supplied by a separate runner package (`@storyshelf/runner-playwright` today). The runner is swappable, so a future alternative (e.g. a remote capture fleet) plugs in here without touching the router or pipeline.

This package is specific to **Node / `@hono/node-server`**. For other runtimes (Azure Functions, Cloudflare Workers, Vercel, Deno, Bun), `createShelfRouter` from `@storyshelf/core` returns a plain Hono app you can wrap with the platform's adapter — see the [Deployment targets](../guides/deployment/) guide.

## Install

```sh
nub add @storyshelf/node-server
```

## Start a server

`serve` is the default command, so either of these starts the server:

```sh
storyshelf-server serve -p 3000 --data-dir ./data --secret <secret> \
  --capture-concurrency 2 --purge-ttl-days 30 --log-level info
```

```sh
storyshelf-server -p 3000 --data-dir ./data
```

Defaults are port `3000`, data directory `./data`, capture concurrency `2`, a 30-day purge TTL, and `info` log level. The server uses SQLite and local storage by default, and captures in-process via `@storyshelf/runner-playwright`.

## Logging

The server constructs a single pino `Logger` (`createShelfLogger`) at startup and shares it across the router, capture runner, and retention job, so request and background logs flow to one structured JSON stream on stdout. `--log-level` sets the minimum level (`trace|debug|info|warn|error|fatal`). To add hosted observability (Sentry, PostHog, Datadog, GCP, OTEL, etc.), attach extra pino worker `transports` when building the logger — see [@storyshelf/core](../packages/core/).

## How it fits

Client commands (`init`, `upload`, `retry`, `purge`) live in `@storyshelf/cli`, which carries no Playwright or router dependencies and talks to this server over `/api/v1`. The Playwright renderer itself lives in `@storyshelf/runner-playwright`.

This is the **Node deployment** of StoryShelf. The `@storyshelf/core` library itself is runtime-agnostic; when you need Turso instead of SQLite, S3 instead of local storage, or a serverless host, assemble your own `createShelfRouter` — see the [Deployment targets](../guides/deployment/) guide.
