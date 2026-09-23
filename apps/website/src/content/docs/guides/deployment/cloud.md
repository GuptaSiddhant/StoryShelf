---
title: Cloud assembly
description: Assemble StoryShelf for any cloud — swap database, storage, queue, and auth per target.
---

StoryShelf is **cross-runtime**: the core router (`createShelfApp`) uses only Web-standard APIs (`Request`, `Response`, `fetch`, `ReadableStream`, `crypto`, `URL`). There is no Node coupling in the core, so you can deploy on any platform that runs JavaScript.

## Mix-and-match layers

| Platform | Database | Storage | Capture queue | Auth | Server entry |
|----------|----------|---------|---------------|------|--------------|
| **Vercel** | `@storyshelf/db-turso` (Turso/libSQL) | `@storyshelf/storage-s3` (R2/S3) | Remote `CaptureQueue` (see below) | `@storyshelf/auth-oauth` | Hono + `@hono/vercel-edge` |
| **Cloudflare Workers** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` (R2) | Workers Queues `CaptureQueue` impl | `@storyshelf/auth-oauth` | Hono + Workers entry |
| **Azure Functions** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` (Azure Blob) | Azure Storage Queues `CaptureQueue` impl | `@storyshelf/auth-oauth` | Hono + Azure Functions handler |
| **AWS Lambda** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` (S3) | SQS `CaptureQueue` impl | `@storyshelf/auth-oauth` | Hono + Lambda handler |
| **Deno Deploy** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` (R2/S3) | Custom `CaptureQueue` (Deno KV / HTTP) | `@storyshelf/auth-oauth` | Hono + Deno entry |
| **Bun** | `@storyshelf/db-sqlite` or `db-turso` | `storage-local` or `storage-s3` | `InMemoryCaptureQueue` | `@storyshelf/auth-oauth` | Hono + Bun.serve |

## Worker model (serverless)

On serverless platforms, the request handler **must not run capture** (isolate freezes after response). Instead:

1. **API handler** enqueues via `CaptureQueue.enqueue({ buildId, reqId })` — returns immediately.
2. **Separate worker** (always-on service, background job, or scheduled function) polls the remote queue and calls `executeCaptureJob({ buildId, reqId }, jobOptions)` for each message.

The `InMemoryCaptureQueue` (default) runs the worker inline — suitable only for long-lived hosts (Node, Bun, Deno, Fly.io, Railway, Render, VPS). For serverless, provide a `CaptureQueue` that pushes to your platform's queue (SQS, Workers Queues, Azure Storage Queues, etc.) and deploy a companion worker.

```ts
import type { CaptureQueue, CaptureJob } from "@storyshelf/core/adapter/capture-queue";

export class HttpCaptureQueue implements CaptureQueue {
  constructor(private readonly endpoint: string) {}
  async enqueue(job: CaptureJob): Promise<void> {
    await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
  }
  async status() { return null; }
  async active() { return []; }
  async recent() { return []; }
}

import { createShelfApp } from "@storyshelf/app";
import { HttpCaptureQueue } from "./my-queue";

const router = createShelfApp({
  database: ...,
  storage: ...,
  captureRunner: ...,
  captureQueue: new HttpCaptureQueue("https://my-worker.example.com/capture"),
});
```

> **Note:** Cross-runtime queue integration is currently unit-tested with `InMemoryCaptureQueue`. A real-queue worker test (SQS / Workers Queues / Azure Storage Queues) is tracked separately.

## Minimal Turso + S3 recipe

```ts
import { createShelfApp } from "@storyshelf/app";
import { createTursoDatabase } from "@storyshelf/db-turso";
import { createS3Storage } from "@storyshelf/storage-s3";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { InMemoryCaptureQueue } from "@storyshelf/core/capture";

const database = createTursoDatabase({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
const storage = createS3Storage({
  bucket: process.env.S3_BUCKET!,
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
});
const capture = createPlaywrightCaptureRunner();
const queue = new InMemoryCaptureQueue({ concurrency: 2 });

export const app = createShelfApp({
  database, storage, captureRunner: capture, captureQueue: queue,
  config: { scratchDir: "/tmp/scratch" },
  auth: ...,
});
await app.lifecycle.init();
```

This runs on **any** platform that supports Node-compatible `fetch` + `crypto` + `sqlite`/`libsql`.

## Postgres providers

`@storyshelf/db-postgres` uses `postgres.js` + Drizzle. Use `createPostgresDatabase({ url })` for all providers — only the connection string and pooling change.

| Provider | Connection shape | TLS | Pooling |
|----------|----------------|-----|---------|
| Self-hosted | `postgres://user:pass@localhost:5432/shelf` | `ssl: false` | `max: 10` |
| AWS RDS | `postgres://user:pass@<rds-endpoint>:5432/db?sslmode=require` | `ssl: true` | `prepare: true` |
| GCP Cloud SQL | `postgres://user:pass@<cloudsql-ip>:5432/db` | `ssl: { ca, cert, key }` | Connector or injected client |
| Supabase | `postgres://postgres.<ref>:<pass>@<pooler-host>:6543/postgres?pgbouncer=true` | `ssl: true` | `prepare: false` on :6543 |
| Neon | `postgres://user:pass@<neon-host>/db?sslmode=require` | `ssl: true` | `max: 5`; `prepare: false` on pooled |
| Azure DB for PG | `postgres://user:pass@<server>.postgres.database.azure.com:5432/db?sslmode=require` | `ssl: true` | Entra ID via injected client |

See the [`@storyshelf/db-postgres` package reference](/packages/db-postgres/) for full options.

## Related

- [AWS](/guides/deployment/aws/) · [Azure](/guides/deployment/azure/) · [GCP](/guides/deployment/gcp/) — reference Terraform stacks
- [Docker Compose](/guides/deployment/docker-compose/) — single-host deploy
