---
title: Remote capture workers
description: Run capture on separate workers behind SQS, Redis, Azure, or GCP queues — deployment, scaling, failure modes, and monitoring.
---

By default the server captures in-process. For horizontally scaled or serverless deployments you can move capture to separate **workers** that pull jobs from a queue. The guide uses SQS as the worked example. The worker is the same for every queue, and [Other queues](#other-queues) covers what differs for Redis, Azure, and GCP Pub/Sub.

## How it fits together

```
upload ─▶ server ──enqueue──▶ SQS ◀──poll/ack── worker(s) ──▶ database + storage
              │                                       │
              └────────── shared database + storage ──┘
```

- The server stores the upload, creates the build, and **enqueues a message** `{ buildId, reqId, traceparent }`. It returns `202` immediately.
- Workers poll the queue, run the same capture pipeline as the in-process path (extract Storybook, render stories, diff, persist, post git statuses), then acknowledge the message.
- A remote queue can't be peeked, so the server's compute-jobs view has no queue entries. **The `builds` table is the source of truth** for progress.
- Server and workers must share the **same database and storage**. SQLite on a local disk and `storage-local` won't work across hosts; use Postgres/Turso and S3-compatible storage.

## Set up

### Server

Pass the SQS queue as `captureQueue` (see [`@storyshelf/queue-sqs`](/packages/queue-sqs/)):

```ts
import { createSqsCaptureQueue } from "@storyshelf/queue-sqs";

const app = createShelfApp({
  database,
  storage,
  captureRunner,
  captureQueue: createSqsCaptureQueue({ queueUrl: process.env.QUEUE_URL! }),
});
```

The server no longer runs captures itself, so `captureConcurrency` / `--capture-concurrency` has no effect.

### Worker

Scaffold it with `storyshelf worker init` (or choose a remote queue in `storyshelf server init`). That writes a `src/worker.ts` wired to your adapters and a `Dockerfile.worker` based on the Playwright image. See [`@storyshelf/worker`](/packages/worker/) for the code.

Give the worker the same database, storage, and `SECRET` as the server, plus `QUEUE_URL` and credentials for SQS (IAM task role or standard AWS env). Run it locally with `storyshelf worker serve --concurrency 2`.

The [AWS stack](/guides/deployment/aws/) provisions the queue, a dead-letter queue, and an ECS Fargate worker for you.

### Docker or Fly

A worker serves no HTTP, so it needs no port or health endpoint.

```sh
docker build -f Dockerfile.worker -t storyshelf-worker .
docker run --env-file .env storyshelf-worker
```

On Fly, deploy `Dockerfile.worker` as its own app without an `[http_service]` section, set the same secrets as the server (`fly secrets set`), and scale with `fly scale count <n>`. Set `kill_timeout` high enough for a capture to finish (see [Shutdown](#shutdown)).

## Concurrency and scaling

Parallel captures = **workers × `WORKER_CONCURRENCY`** (default 2 per worker, from `config.concurrency`).

- Each concurrent capture drives a browser and unzips a Storybook into the scratch dir. Size memory and disk per worker for `concurrency` captures at once. Start at the default and raise it only after watching memory.
- To go wider, prefer more workers over higher concurrency: a crashed worker then loses fewer jobs, and one oversized Storybook can't starve the others.
- Scale on queue backlog. In CloudWatch, `ApproximateNumberOfMessagesVisible` and `ApproximateAgeOfOldestMessage` on the capture queue show whether workers keep up.
- A worker polls one message at a time (long-poll, 20 seconds). It stops polling while all slots are busy, so extra jobs wait safely in SQS.

## Failure modes

| What happens | Result |
|---|---|
| Capture throws | Worker requeues with exponential backoff (1s, 2s, 4s… capped at 30s). The default is `maxRetries: 2`, so **3 attempts total**. |
| Still failing after the last attempt | Message is deleted, the build attempt is marked `failed`, a `failure` git status is posted, and the log line `capture permanently failed` is written. Re-run with **Retry** or `storyshelf retry`. |
| Worker dies mid-capture (OOM, `SIGKILL`, deploy) | The message reappears after the visibility timeout. Past `maxReceiveCount` (3 in the Terraform stack) SQS moves it to the **dead-letter queue**. |
| Message body has no `buildId` | Treated as poison: deleted immediately, with a `dropping malformed queue job` warning. It never retries. |

Two things to know:

- **The worker renews the lease while a capture runs.** It extends the message's visibility timeout at a third of the lease (every 100 seconds with the 300-second default), so a long capture is never redelivered while its worker is alive. Renewal failures are logged once per job and never kill a healthy capture. If the queue reports the message is gone (another worker already owns it), the worker cancels its render and leaves ack/nack to the new owner. `visibilityTimeout` is now only a **backstop for crashes**: it sets how long a dead worker's job waits before being retried, so keep it short enough to recover quickly (for SQS, also keep the queue's own timeout in line with the option).
- **Failures on remote workers don't reach the server's failure notifications.** The server never sees those outcomes, so alert from worker logs or the dead-letter queue instead.

A message in the DLQ usually means the build stays in `capturing`. Inspect and redrive or delete the message, then **Retry** the build.

## Shutdown

The worker traps `SIGTERM`/`SIGINT`, stops polling, and waits for in-flight captures to finish. Set the platform's stop timeout longer than a typical capture: `docker stop -t`, ECS `stopTimeout` (max 120 seconds on Fargate), or Fly `kill_timeout`. A job cut off by a shorter timeout is retried after the visibility timeout, as in the crash case above.

## Monitoring

The worker logs structured JSON through pino, with `buildId` and `reqId` on each line:

| Message | Meaning |
|---|---|
| `worker picked up job` / `worker completed job` | Normal lifecycle. |
| `worker job timings` | Per-phase timings for the job (`timings`). |
| `capture failed, requeued` | A retry is scheduled (`attempts`, `delayMs`). |
| `capture permanently failed` | Retries exhausted. Alert on this one. |
| `poll failed` | SQS or credentials problem; the worker retries every second. |
| `dropping malformed queue job` | Poison message removed. |

`reqId` ties worker lines to the upload request that enqueued the build, and the `traceparent` in the message continues the trace when [OpenTelemetry](/guides/observability/) is configured. Also alert on any message in the DLQ.

## Other queues

Every queue implements the same contract (`enqueue` on the server; `poll`/`ack`/`nack` for the worker), so the worker code, concurrency math, and monitoring above apply unchanged. What differs is how each backend handles in-flight jobs, retries, and poison messages.

| | SQS | Redis | Azure Storage Queues | Azure Service Bus | GCP Pub/Sub |
|---|---|---|---|---|---|
| **Package** | `queue-sqs` | `queue-redis` | `queue-azure` | `queue-azure` | `queue-gcp` |
| **Idle poll** | Long-poll (20s) | Blocking `BLMOVE` (5s) | Immediate return | Waits up to 30s | Immediate return |
| **Retry delay (`nack`)** | Honored | Honored | Honored | **Not honored** (immediate) | Honored |
| **Dead-letter queue** | Redrive policy | **None** | **None** | Built in (`maxDeliveryCount`) | Dead-letter policy |
| **Crash recovery** | Visibility timeout | **Manual** | Visibility timeout | Lock expiry | Ack deadline |
| **Lease renewal while capturing** | Heartbeat | **None** | Heartbeat | Heartbeat | Heartbeat |
| **Attempts counted from** | Receive count | Counter in the payload | Dequeue count | Delivery count | Delivery attempt |
| **Scaffold** | AWS stack | Docker Compose | Azure stack | Azure stack | GCP stack |

### Redis

Best for self-hosted Docker Compose, with no cloud dependency. Server and workers share one Redis instance (6.2+ for `BLMOVE`).

```ts
// server and worker
const queue = createRedisCaptureQueue({ url: process.env.REDIS_URL! });
```

Keys: `shelf:queue` (waiting), `shelf:queue:processing` (in flight), `shelf:queue:delayed` (retry backoff). Set `key` to run several StoryShelf environments on one Redis.

- **No lease renewal.** Redis has no visibility timeout, so there is nothing for the worker to extend. The manual `processing`-list reclaim below stays the recovery path.
- **A crashed worker's job stays in `…:processing`.** The adapter doesn't reclaim it, because Redis has no visibility timeout. After an OOM or hard kill, check that list. Move the entry back to the main list (for example with `LMOVE`), or **Retry** the build from the UI. Graceful `SIGTERM` shutdown is much more important here than on SQS.
- **There is no dead-letter queue.** After the last retry the worker drops the job and logs `capture permanently failed`.
- **Retries wait in the delayed set** and are promoted by whichever worker polls next, so at least one worker must keep running.
- Make Redis durable (AOF persistence) if you can't afford to lose queued jobs on a restart. Builds are recoverable with **Retry** either way.

### Azure

`@storyshelf/queue-azure` has two backends. Pick with `storyshelf server init` (Azure target), or construct one directly:

```ts
import { createAzureServiceBusQueue, createAzureStorageQueuesQueue } from "@storyshelf/queue-azure";

createAzureServiceBusQueue({ queueName: "capture-jobs", connectionString: process.env.AZURE_SERVICE_BUS_CONNECTION! });
createAzureStorageQueuesQueue({ queueName: "capture-jobs", connectionString: process.env.AZURE_STORAGE_CONNECTION! });
```

**Service Bus** (recommended for production):
- Messages are peek-locked. Past the queue's `maxDeliveryCount` (3 in the Terraform stack) Service Bus moves the message to the built-in dead-letter sub-queue.
- **`nack` retries immediately.** There is no per-message delay, so the worker's exponential backoff does not apply. Three quick attempts can burn through a transient outage before it recovers.
- **The worker renews the lock while capturing.** Service Bus caps one lock at 5 minutes, so the worker renews it periodically (at a third of the queue's `lock_duration`) rather than relying on one long lock. Captures can run well past 5 minutes. The queue's lock duration only needs to be long enough to survive a brief renewal hiccup; the default is fine.

**Storage Queues** (cheapest, simplest):
- `visibilityTimeout` is the lease, 300 seconds by default (option on `createAzureStorageQueuesQueue`). The worker renews it while a capture runs; it only decides how fast a crashed worker's job comes back. Storage Queues rotate the pop receipt on each renewal, which the adapter tracks for you.
- There is no dead-letter queue and no long-poll. A job that crashes its worker every time keeps coming back, so alert on repeated `capture failed, requeued` lines for the same `buildId`. If you need dead-lettering, use Service Bus.
- With no long-poll, an idle worker issues requests continuously, and each is a billable storage transaction.

### GCP Pub/Sub

[`@storyshelf/queue-gcp`](/packages/queue-gcp/) uses a **pull subscription** with synchronous pull, one message at a time:

```ts
import { createGcpPubSubQueue } from "@storyshelf/queue-gcp";

createGcpPubSubQueue({ topic: "capture-jobs", subscription: "capture-jobs-worker", projectId: process.env.GOOGLE_CLOUD_PROJECT! });
```

- The adapter sets each pulled message's **ack deadline** to `leaseSeconds` (60 by default, max 600) and the worker renews it while a capture runs, so the subscription's own ack deadline no longer needs to outlast your slowest capture.
- Poison messages are dead-lettered by the subscription's dead-letter policy (`max_delivery_attempts` is 5 in the stack). The attempt count only appears when a dead-letter policy is set, so don't skip it.
- Pull returns immediately when the queue is empty, so an idle worker polls continuously.
- The subscription name in the code must match the one Terraform creates. The scaffolded worker default is `capture-jobs-worker`, while the stack's subscription resource is named `capture-jobs`, so set `subscription` to whichever you actually deployed.
- Grant the worker's service account Pub/Sub subscriber and the server's publisher roles after `terraform apply`.

## Related

- [`@storyshelf/queue-sqs`](/packages/queue-sqs/) · [`queue-redis`](/packages/queue-redis/) · [`queue-azure`](/packages/queue-azure/) · [`queue-gcp`](/packages/queue-gcp/) · [`@storyshelf/worker`](/packages/worker/)
- [AWS](/guides/deployment/aws/) · [Azure](/guides/deployment/azure/) · [GCP](/guides/deployment/gcp/) · [Deployment overview](/guides/deployment/)
- [Capture & viewports](/concepts/capture/)
