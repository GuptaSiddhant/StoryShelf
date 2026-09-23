---
title: "@storyshelf/worker"
description: Remote capture worker — polls a CaptureQueue and runs the StoryShelf capture pipeline.
---

`@storyshelf/worker` is a transport-agnostic **remote capture worker**. It polls any `PollableCaptureQueue` (SQS, Redis, Azure Storage Queues / Service Bus today) and runs the capture pipeline with any `CaptureRunner` (Playwright or Puppeteer). The worker shares the server's `DatabaseAdapter` + `StorageAdapter` — Turso/S3 for a serverless split, Postgres/local for single-host.

## Install

```sh
nub add @storyshelf/worker
```

[![JSR](https://jsr.io/badges/@storyshelf/worker)](https://jsr.io/@storyshelf/worker) [![JSR Score](https://jsr.io/badges/@storyshelf/worker/score)](https://jsr.io/@storyshelf/worker)

- [npm package](https://www.npmjs.com/package/@storyshelf/worker) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/worker) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/worker/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/worker) — package directory on `main`.

## Create and run

```ts
import { createCaptureWorker } from "@storyshelf/worker";
import { createSqsCaptureQueue } from "@storyshelf/queue-sqs";
import { createTursoDatabase } from "@storyshelf/db-turso";
import { createS3Storage } from "@storyshelf/storage-s3";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

const queue = createSqsCaptureQueue({ queueUrl: process.env.QUEUE_URL! });
const worker = createCaptureWorker({
  queue,
  db: createTursoDatabase({ url: process.env.TURSO_URL!, authToken: process.env.TURSO_AUTH_TOKEN }),
  storage: createS3Storage({ bucket: process.env.S3_BUCKET! }),
  runner: createPlaywrightCaptureRunner(), // or createPuppeteerCaptureRunner()
  scratchDir: "/tmp/shelf",
  // gitHosts, secret: optional (status fanout / webhook signing)
});

await worker.start();
// on SIGTERM: await worker.stop();
```

Or scaffold it with `storyshelf server init` / `storyshelf worker init` — the CLI detects the chosen queue/storage adapters and writes a `worker.ts` wired to them, plus `docker-compose` when Redis/local is selected.

## Options

```ts
interface WorkerOptions {
  queue: CaptureQueue | PollableCaptureQueue; // any pollable queue
  poll?: (opts?: { waitMs?: number }) => Promise<PollableJob | null>;
  ack?: (job: PollableJob) => Promise<void>;  // override for custom transports
  nack?: (job: PollableJob, opts?: { requeue?: boolean; delayMs?: number }) => Promise<void>;
  db: DatabaseAdapter;
  tables?: WorkerTables;       // defaults to sqlite schema handles
  storage: StorageAdapter;
  runner: CaptureRunner;
  scratchDir: string;
  gitHosts?: GitHostProvider[];
  secret?: string;
  logger?: Logger;
  config?: Partial<WorkerConfig>; // concurrency, poll interval, etc.
}
```

The worker resolves `PollableJob` via the queue's `poll/ack/nack`, then calls the same `executeCaptureJob` / `createDispatchJob` path as the in-process orchestrator — build loading, Storybook extraction to `scratchDir`, story discovery, `runner.render(...)`, diff + persist, status fanout. Baselines remain browser-aware (`infraHashFor(browser, viewports, defaults)`).

## When to use it

Use a remote worker when the app host shouldn't run Playwright itself — AWS Lambda / Fargate, Cloud Run / GKE, Azure Container Apps / AKS, or any horizontally-scaled deploy where capture belongs on a separate long-lived process. For single-host Docker Compose or local dev, the server's in-process `InMemoryCaptureQueue` (no worker) is sufficient.
