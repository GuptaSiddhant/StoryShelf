---
title: Deployment
description: Deploy StoryShelf with Docker, subdomains, and auth.
---

## Docker Compose

```yaml
services:
  storyshelf:
    image: storyshelf:latest
    ports:
      - "3000:3000"
    volumes:
      - storyshelf-data:/app/data
    environment:
      - SECRET=change-me
      - CAPTURE_CONCURRENCY=2
      - PURGE_TTL_DAYS=30
      - OIDC_ISSUER=https://keycloak.example.com/realms/myteam
      - OIDC_CLIENT_ID=storyshelf
      - OIDC_CLIENT_SECRET=secret
      # or shared password: AUTH_PASSWORD=change-me
volumes:
  storyshelf-data:
```

## Published Storybook subdomains

Opt in to per-project subdomains by setting `PUBLISHED_BASE_DOMAIN` and adding a wildcard DNS record + TLS cert:

```txt
*.stories.example.com  →  your.server
```

Then `https://<slug>.stories.example.com` serves the latest published Storybook, and `https://<buildId>.<slug>.stories.example.com` serves a specific build.

## Auth

- **OIDC** — plug into Keycloak, Authentik, Okta, GitHub, GitLab.
- **Shared password** — `AUTH_PASSWORD` for small teams.
- **None** — for VPN-protected deployments.

## Deployment targets — bring your own assembly

StoryShelf is **cross-runtime**: the core router (`createShelfRouter`) uses only Web-standard APIs (`Request`, `Response`, `fetch`, `ReadableStream`, `crypto`, `URL`). There is no Node coupling in the core. This means you can assemble and deploy on any platform that runs JavaScript.

### Recommended assembly (self-hosted default)

Use `storyshelf server init` to scaffold a server with your chosen adapters:

```sh
storyshelf server init
# ? Which database? SQLite
# ? Which storage? Local filesystem
# ? Which auth? None
# ? Which git provider? None
```

This generates `server.ts` + `package.json` with the correct imports and dependencies.

| Layer | Package | Notes |
|-------|---------|-------|
| Database | `@storyshelf/db-sqlite` | better-sqlite3 + Drizzle, WAL mode, single file |
| Storage | `@storyshelf/storage-local` | Local filesystem, `--data-dir` |
| Capture queue | `InMemoryCaptureQueue` (built-in) | Async, concurrency-limited, in-process |
| Auth | `@storyshelf/auth-oauth` or `@storyshelf/auth-password` | OIDC or shared password |

One `npm start` (or `fly deploy`, `railway up`, `render.com`, etc.) and you're running.

### Cloud assembly (all clouds equal)

You can swap each layer independently. All major serverless platforms are first-class targets — **no single cloud is preferred**.

| Platform | Database | Storage | Capture queue | Auth | Server entry |
|----------|----------|---------|---------------|------|--------------|
| **Vercel** | `@storyshelf/db-turso` (Turso/libSQL) | `@storyshelf/storage-s3` (R2/S3) | Remote `CaptureQueue` (see below) | `@storyshelf/auth-oauth` | Hono + `@hono/vercel-edge` |
| **Cloudflare Workers** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` (R2) | Workers Queues `CaptureQueue` impl | `@storyshelf/auth-oauth` | Hono + Workers entry |
| **Azure Functions** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` (Azure Blob) | Azure Storage Queues `CaptureQueue` impl | `@storyshelf/auth-oauth` | Hono + Azure Functions handler |
| **AWS Lambda** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` (S3) | SQS `CaptureQueue` impl | `@storyshelf/auth-oauth` | Hono + Lambda handler |
| **Deno Deploy** | `@storyshelf/db-turso` | `@storyshelf/storage-s3` (R2/S3) | Custom `CaptureQueue` (Deno KV / HTTP) | `@storyshelf/auth-oauth` | Hono + Deno entry |
| **Bun** | `@storyshelf/db-sqlite` or `db-turso` | `storage-local` or `storage-s3` | `InMemoryCaptureQueue` | `@storyshelf/auth-oauth` | Hono + Bun.serve |

#### Capture queue worker model (serverless)

On serverless platforms, the request handler **must not run capture** (isolate freezes after response). Instead:

1. **API handler** enqueues via `CaptureQueue.enqueue({ buildId, reqId })` — returns immediately.
2. **Separate worker** (always-on service, background job, or scheduled function) polls the remote queue and calls `executeCaptureJob({ buildId, reqId }, jobOptions)` for each message.

The `InMemoryCaptureQueue` (default) runs the worker inline — suitable only for long-lived hosts (Node, Bun, Deno, Fly.io, Railway, Render, VPS). For serverless, provide a `CaptureQueue` implementation that pushes to your platform's queue (SQS, Workers Queues, Azure Storage Queues, etc.) and deploy a companion worker that runs the capture.

```ts
// Example: custom CaptureQueue pushing to an HTTP endpoint (worker picks up)
import type { CaptureQueue, CaptureJob } from "@storyshelf/core";

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

// In your serverless entry:
import { createShelfRouter } from "@storyshelf/core";
import { HttpCaptureQueue } from "./my-queue";

const router = createShelfRouter({
  database: ...,
  storage: ...,
  capture: ...,
  queue: new HttpCaptureQueue("https://my-worker.example.com/capture"),
  // ...
});
```

> **TODO**: Add cross-runtime queue integration test (e.g., spin up a test worker against a real queue backend) — currently only unit-tested with `InMemoryCaptureQueue`.

### Minimal Turso + S3 recipe

```ts
import { createShelfRouter } from "@storyshelf/core";
import { createTursoDatabase } from "@storyshelf/db-turso";
import { createS3Storage } from "@storyshelf/storage-s3";
import { createPlaywrightCaptureRunner } from "@storyshelf/runner-playwright";
import { InMemoryCaptureQueue } from "@storyshelf/core";

const database = createTursoDatabase({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
const storage = createS3Storage({
  bucket: process.env.S3_BUCKET!,
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT, // for R2/MinIO
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
});
const capture = createPlaywrightCaptureRunner();
const queue = new InMemoryCaptureQueue({ concurrency: 2 });

export const app = createShelfRouter({
  database,
  storage,
  capture,
  queue,
  config: { scratchDir: "/tmp/scratch" },
  auth: ...,
});
```

This runs on **any** platform that supports Node-compatible `fetch` + `crypto` + `sqlite`/`libsql` — including all clouds above.
