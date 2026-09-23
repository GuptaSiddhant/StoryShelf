---
title: "@storyshelf/queue-azure"
description: Azure capture queue adapter — Storage Queues or Service Bus — for StoryShelf cloud deploys.
---

`@storyshelf/queue-azure` backs StoryShelf's capture queue with **Azure Storage Queues** *or* **Azure Service Bus**, selectable per-deploy. It implements the `CaptureQueue` / `PollableCaptureQueue` contract from `@storyshelf/core`, so switching between in-process, Redis, SQS, and Azure is a single dependency swap — no router or build changes.

## Install

```sh
nub add @storyshelf/queue-azure
# plus only the peer you use:
nub add @azure/storage-queue   # for Storage Queues
# or
nub add @azure/service-bus     # for Service Bus
```

[![JSR](https://jsr.io/badges/@storyshelf/queue-azure)](https://jsr.io/@storyshelf/queue-azure) [![JSR Score](https://jsr.io/badges/@storyshelf/queue-azure/score)](https://jsr.io/@storyshelf/queue-azure)

- [npm package](https://www.npmjs.com/package/@storyshelf/queue-azure) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/queue-azure) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/queue-azure/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/queue-azure) — package directory on `main`.

## Pick a backend

### Async dispatcher (when the backend is chosen at runtime)

```ts
import { createAzureQueue } from "@storyshelf/queue-azure";

const queue = await createAzureQueue({
  backend: "storage-queues",
  queueName: "capture-jobs",
  connectionString: process.env.AZURE_STORAGE_CONNECTION!,
  visibilityTimeout: 300, // seconds
});
```

```ts
import { createAzureQueue } from "@storyshelf/queue-azure";

const queue = await createAzureQueue({
  backend: "service-bus",
  queueName: "capture-jobs",
  connectionString: process.env.AZURE_SERVICEBUS_CONNECTION!,
});
```

### Sync subpaths (when the backend is known at build time)

```ts
import { createAzureStorageQueuesQueue } from "@storyshelf/queue-azure/storage-queues";
import { createAzureServiceBusQueue } from "@storyshelf/queue-azure/service-bus";
```

Both SDK packages are **optional peer dependencies** — install only the one you use; the dispatcher never loads a backend's SDK until that backend is selected, so bare `import "@storyshelf/queue-azure"` is safe without either SDK.

## Options

```ts
interface AzureStorageQueuesQueueOptions {
  queueName: string;          // required
  connectionString: string;   // required
  client?: QueueClient;       // optional injected client (tests)
  visibilityTimeout?: number; // default 300
  waitMs?: number;            // polling HTTP timeout, default 20000
  logger?: Logger;
}

interface AzureServiceBusQueueOptions {
  queueName: string;
  connectionString: string;
  client?: ServiceBusClient;
  logger?: Logger;
}
```

Storage Queues has no long-polling — `poll` waits at most `waitMs`. `status`/`active`/`recent` return empty results (the builds table is the source of truth, same as SQS/Redis).

## Run a worker

Pair the queue with `@storyshelf/worker` and any database/storage pair:

```ts
import { createAzureStorageQueuesQueue } from "@storyshelf/queue-azure/storage-queues";
import { createCaptureWorker } from "@storyshelf/worker";
import { createTursoDatabase } from "@storyshelf/db-turso";
import { createAzureStorage } from "@storyshelf/storage-azure";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";

const queue = await createAzureStorageQueuesQueue({
  queueName: "capture-jobs",
  connectionString: process.env.AZURE_STORAGE_CONNECTION!,
});
const worker = createCaptureWorker({
  queue, scratchDir: "/tmp/shelf",
  db: createTursoDatabase({ url: process.env.TURSO_URL! }),
  storage: createAzureStorage({ container: process.env.AZURE_CONTAINER! }),
  runner: createPlaywrightCaptureRunner(),
});
await worker.start();
```

`storyshelf server init` / `storyshelf worker init` scaffold the same composition when **Azure** is chosen for the queue.

## When to use it

Use `queue-azure` on Azure — Container Apps, AKS, or Functions — where the server and capture worker should be decoupled. **Storage Queues** is the cheapest/most testable (works against the Azurite emulator); **Service Bus** adds native dead-lettering for SQS + DLQ parity. For a single-host deploy, `InMemoryCaptureQueue` is sufficient; for Redis and AWS alternatives see [queue-redis](../queue-redis/) and [queue-sqs](../queue-sqs/).
