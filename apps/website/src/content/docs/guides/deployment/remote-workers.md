---
title: Remote capture workers
description: Run capture on separate workers behind an SQS queue — deployment, scaling, failure modes, and monitoring.
---

By default the server captures in-process. For horizontally scaled or serverless deployments you can move capture to separate **workers** that pull jobs from a queue. This guide covers the SQS setup; the worker is the same for the other queues ([Redis](/packages/queue-redis/), [Azure](/packages/queue-azure/)).

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

Scaffold it with `storyshelf worker init` (or choose a remote queue in `storyshelf server init`). That writes a `worker.ts` wired to your adapters and a `Dockerfile.worker` based on the Playwright image. See [`@storyshelf/worker`](/packages/worker/) for the code.

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

- **Visibility timeout must exceed your longest capture.** The default is 300 seconds (queue and Terraform stack). The worker doesn't extend the timeout while it works, so a capture longer than that is redelivered to another worker while the first is still running. Raise `visibilityTimeout` on `createSqsCaptureQueue` **and** the queue itself.
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

## Related

- [`@storyshelf/queue-sqs`](/packages/queue-sqs/) · [`@storyshelf/worker`](/packages/worker/)
- [AWS deployment](/guides/deployment/aws/) · [Deployment overview](/guides/deployment/)
- [Capture & viewports](/concepts/capture/)
