---
title: "@storyshelf/queue-redis"
description: Redis capture job queue adapter for StoryShelf self-hosted Docker Compose.
---

`@storyshelf/queue-redis` backs StoryShelf's capture queue with Redis for self-hosted Docker Compose. It implements the `CaptureQueue` contract from `@storyshelf/core`: `enqueue` submits a build for capture (returning once queued), and a separately-assembled worker polls the queue and runs `executeCaptureJob`. Because it implements the same interface as `InMemoryCaptureQueue` and `queue-sqs`, switching between in-process, Redis, and SQS is a single dependency swap — no app or build changes.

## Install

```sh
nub add @storyshelf/queue-redis
```

[![JSR](https://jsr.io/badges/@storyshelf/queue-redis)](https://jsr.io/@storyshelf/queue-redis) [![JSR Score](https://jsr.io/badges/@storyshelf/queue-redis/score)](https://jsr.io/@storyshelf/queue-redis)

- [npm package](https://www.npmjs.com/package/@storyshelf/queue-redis) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/queue-redis) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/queue-redis/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/queue-redis) — package directory on `main`.

## Register the queue

Pass the Redis-backed queue as the `captureQueue` option of `createShelfApp`:

```ts
import { createShelfApp } from "@storyshelf/app";
import { createRedisCaptureQueue } from "@storyshelf/queue-redis";

const queue = createRedisCaptureQueue({
  url: "redis://localhost:6379",
  // key: "shelf:queue", // default
});

const app = createShelfApp({
  database,
  storage,
  captureQueue: queue,
});
```

Or with an existing client:

```ts
import { Redis } from "ioredis";
const client = new Redis("redis://localhost:6379");
const queue = createRedisCaptureQueue({ client });
```

## Options

```ts
interface RedisCaptureQueueOptions {
  client?: Redis;          // pre-configured ioredis client
  url?: string;            // redis:// URL
  key?: string;            // queue key, default "shelf:queue"
  logger?: Logger;         // optional pino logger
  waitTimeSeconds?: number;// BLMOVE timeout, default 5
}
```

Jobs are pushed with `LPUSH`, polled with `BLMOVE` (processing list), delayed requeues via `ZSET` (`{key}:delayed`). `ack` removes from processing, `nack` requeues immediately or delayed.

## Run a worker

A separate worker process polls Redis and calls `executeCaptureJob` via `createCaptureWorker`:

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

Or use `storyshelf server init` and choose **Redis** for the capture queue — it scaffolds `server.ts` and `worker.ts` with `docker-compose` including a `redis` service.

## When to use it

Use `queue-redis` for self-hosted Docker Compose where you want horizontal workers without AWS. For a single-host deployment, `InMemoryCaptureQueue` is sufficient. For AWS-hosted stacks, `queue-sqs` is the managed alternative. Redis requires 6.2+ for `BLMOVE` (falls back to `BRPOPLPUSH`).
