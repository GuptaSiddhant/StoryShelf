# @storyshelf/node-server

The self-hosted StoryShelf server for **long-lived Node hosts** (binary `storyshelf-server`): the review UI, SQLite, storage, and the capture pipeline, all in one process. It is the **assembly point** — it wires `@storyshelf/core`, `@storyshelf/db-sqlite`, and `@storyshelf/storage-local`, and injects a `CaptureRunner` implementation supplied by a separate runner package (`@storyshelf/runner-playwright` today).

This package is specific to **Node / `@hono/node-server`**. `@storyshelf/core`'s `createShelfRouter` itself is runtime-agnostic — for Azure Functions, Cloudflare Workers, Vercel, Deno, or Bun, wrap the Hono app with the platform's adapter instead (see `docs/architecture.md` and the website deployment guide).

### Cross-runtime assembly

For serverless / non-Node targets, compose `@storyshelf/core` with platform-specific adapters:

```ts
// Vercel example (edge runtime)
import { createShelfRouter } from "@storyshelf/core";
import { createTursoDatabase } from "@storyshelf/db-turso";
import { createS3Storage } from "@storyshelf/storage-s3";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { InMemoryCaptureQueue } from "@storyshelf/core";

const app = createShelfRouter({
  database: createTursoDatabase({ url: process.env.TURSO_URL!, authToken: process.env.TURSO_AUTH_TOKEN! }),
  storage: createS3Storage({ bucket: process.env.S3_BUCKET!, ... }),
  capture: createPlaywrightCaptureRunner(),
  queue: new InMemoryCaptureQueue({ concurrency: 2 }), // or remote queue + worker
  config: { scratchDir: "/tmp/scratch" },
  auth: ...,
});

export default app;
```

All clouds are equal — see the **Deployment** guide for the full matrix and a minimal Turso + S3 recipe.

## Install

```sh
nub add @storyshelf/node-server
```

or

```sh
npm install @storyshelf/node-server
```

## Quick start

```sh
storyshelf-server serve -p 3000 --data-dir ./data --secret <s> \
  --capture-concurrency 2 --purge-ttl-days 30
```

`serve` is the default command, so `storyshelf-server` with no arguments does the same thing.

## API

### Commands

`storyshelf-server serve` — start the StoryShelf server, assembling `@storyshelf/core`, `@storyshelf/db-sqlite`, and `@storyshelf/storage-local`, and running the `@storyshelf/runner-playwright` capture pipeline in-process.

```sh
storyshelf-server serve [-p <port>] [--data-dir <dir>] [--secret <secret>] \
  [--capture-concurrency <n>] [--purge-ttl-days <n>]
```

Defaults: `--port 3000`, `--data-dir ./data`, `--capture-concurrency 2`, `--purge-ttl-days 30`.

## How it fits in

The client verbs (`init`, `upload`, `purge`, `retry`) live in `@storyshelf/cli`, which talks to this server's `/api/v1` endpoints and carries no Playwright or router dependencies. The server pulls the router stack and the default runner (`@storyshelf/runner-playwright`) — keeping `@storyshelf/cli` installable in CI without browsers. The runner is swappable: a future alternative (e.g. a remote runner) implements the same `CaptureRunner` interface and is wired in here.

See `docs/architecture.md` for the capture workflow and `docs/testing.md` for the gated browser integration suite.