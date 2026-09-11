# @storyshelf/queue-redis

Redis capture job queue adapter for StoryShelf: pushes capture jobs to Redis and leaves execution to a separately-assembled worker. Self-hosted alternative to SQS for Docker Compose.

## Install

```sh
nub add @storyshelf/queue-redis
```

or

```sh
npm install @storyshelf/queue-redis
```

Requires a running Redis (6.2+ for `BLMOVE`; falls back to `BRPOPLPUSH`).

## Quick start

```ts
import { createRedisCaptureQueue } from "@storyshelf/queue-redis";
import { createShelfApp } from "@storyshelf/app";

const queue = createRedisCaptureQueue({
  url: "redis://localhost:6379",
  // key: "shelf:queue", // default
});

const app = createShelfApp({
  database, storage,
  captureRunner: myRenderer,
  captureQueue: queue,
});
```

Or pass an existing client:

```ts
import { Redis } from "ioredis";
const client = new Redis("redis://localhost:6379");
const queue = createRedisCaptureQueue({ client });
```

## API

### `RedisCaptureQueueOptions`

```ts
interface RedisCaptureQueueOptions {
  client?: Redis;           // pre-configured ioredis client
  url?: string;             // redis:// URL, used when client not supplied
  key?: string;             // queue key, default "shelf:queue"
  logger?: Logger;          // optional pino logger
  waitTimeSeconds?: number; // BLMOVE timeout, default 5
}
```

### `createRedisCaptureQueue(options): PollableCaptureQueue`

Creates a Redis-backed `CaptureQueue`. Implements `enqueue`, `status`, `active`, `recent` (remote queues return empty — builds table is source of truth), plus `poll`/`ack`/`nack` for workers. Keys used: `{key}`, `{key}:processing`, `{key}:delayed` (ZSET for delayed requeues).

## How it fits in

`queue-redis` is the `captureQueue` option for `createShelfApp` in self-hosted Docker Compose where you want horizontal workers without AWS. It implements the same `CaptureQueue` interface as `InMemoryCaptureQueue` and `queue-sqs`.

See `docs/architecture.md` and ADR 0009.

## Worker

A separate worker process polls Redis and calls `executeCaptureJob`:

```ts
import { createRedisCaptureQueue } from "@storyshelf/queue-redis";
import { createCaptureWorker } from "@storyshelf/worker";
import { createTursoDatabase } from "@storyshelf/db-turso";
import { createS3Storage } from "@storyshelf/storage-s3";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

const queue = createRedisCaptureQueue({ url: process.env.REDIS_URL! });
const worker = createCaptureWorker({
  queue,
  db: createTursoDatabase({ url: process.env.TURSO_URL! }),
  storage: createS3Storage({ bucket: process.env.S3_BUCKET! }),
  runner: createPlaywrightCaptureRunner(),
  scratchDir: "/tmp/shelf",
});
await worker.start();
```

## Development

```sh
nub run build     # bundle with tsdown
nub run fmt       # format with oxfmt
nub run lint      # type-aware lint with oxlint
nub run test      # vitest suite
```

Requires Redis for integration tests; unit tests use a fake client.
