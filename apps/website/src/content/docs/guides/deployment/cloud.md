---
title: Cloud assembly
description: Assemble StoryShelf for any cloud — swap database, storage and auth per target, and choose between hosting only and testing.
---

StoryShelf is **cross-runtime**: the core router (`createShelfApp`) uses only Web-standard APIs (`Request`, `Response`, `fetch`, `ReadableStream`, `crypto`, `URL`). There is no Node coupling in the core, so you can deploy on any platform that runs JavaScript.

## Mix-and-match layers

| Platform               | Database                                                      | Storage                               | Testing                       | Auth               | Server entry                   |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------- | ----------------------------- | ------------------ | ------------------------------ |
| **Vercel**             | `@storyshelf/db-sqlite/turso` (Turso/libSQL)                  | `@storyshelf/storage-s3` (R2/S3)      | Hosting only (no `testing`)   | `@storyshelf/auth` | Hono + `@hono/vercel-edge`     |
| **Cloudflare Workers** | `@storyshelf/db-sqlite/turso`                                 | `@storyshelf/storage-s3` (R2)         | Hosting only (no `testing`)   | `@storyshelf/auth` | Hono + Workers entry           |
| **Azure Functions**    | `@storyshelf/db-sqlite/turso`                                 | `@storyshelf/storage-s3` (Azure Blob) | Hosting only (no `testing`)   | `@storyshelf/auth` | Hono + Azure Functions handler |
| **AWS Lambda**         | `@storyshelf/db-sqlite/turso`                                 | `@storyshelf/storage-s3` (S3)         | Hosting only (no `testing`)   | `@storyshelf/auth` | Hono + Lambda handler          |
| **Bun**                | `@storyshelf/db-sqlite` or `@storyshelf/db-sqlite/bun-sqlite` | `core/storage/local` or `storage-s3` | `testing` (long-running host) | `@storyshelf/auth` | Hono + Bun.serve               |

## Serverless: Storybook hosting only

> Enabling `testing` requires a long-running server (a container, VM, Fly Machine or Kubernetes
> pod). It cannot run on serverless platforms that freeze or end the process after each request
> (Vercel Functions, AWS Lambda, Cloudflare Workers), because capture jobs run for minutes in the
> background and the job consumer must keep running. A serverless deployment can host Storybooks
> only, by leaving `testing` unset.

`testing` needs a process that keeps running between requests: capture jobs run for minutes in the background. Vercel Functions, AWS Lambda, Netlify Functions and Cloudflare Workers freeze or end the process after each request, so on those platforms StoryShelf **hosts Storybooks only**: leave the `testing` option out. See [Hosting only](/concepts/hosting-only/).

- **AWS Lambda.** `createShelfApp` throws at boot when `AWS_LAMBDA_FUNCTION_NAME` is set and `testing.runner` is configured.
- **Vercel and Netlify.** Boot logs a warning when `testing.runner` is configured (`VERCEL` or `NETLIFY` is set).
- **Override.** `STORYSHELF_ALLOW_SERVERLESS=1` silences both, for a host that looks serverless but keeps a process alive.
- **Cloudflare D1.** The `@storyshelf/db-sqlite/d1` preset is a Workers-only binding, so it cannot back an instance with `testing.runner`; `createShelfApp` throws at boot. Turso over the network can.
- **Uploads.** With no consumer on the host, a zip over `maxInlineUnzipSize` is refused with `413`, and `storyshelf upload` falls back to the file-by-file route by itself.

## Minimal Turso + S3 recipe (long-running host with `testing`)

```ts
import { createShelfApp } from "@storyshelf/app";
import { createTursoDatabase } from "@storyshelf/db-sqlite/turso";
import { createS3Storage } from "@storyshelf/storage-s3";
import { createCaptureRunner } from "@storyshelf/runner";

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
const capture = createCaptureRunner();

export const app = createShelfApp({
  database, storage, testing: { runner: capture, concurrency: 2 },
  config: { scratchDir: "/tmp/scratch" },
  auth: ...,
});
await app.lifecycle.setup();
```

Without the `testing` option the same assembly runs on **any** platform that supports Node-compatible `fetch` + `crypto` + `sqlite`/`libsql` (Storybook hosting only). With `testing` it needs a long-running host.

## Postgres providers

`@storyshelf/db-postgres` uses `postgres.js` + Drizzle. Use `createPostgresDatabase({ url })` for all providers — only the connection string and pooling change.

| Provider        | Connection shape                                                                         | TLS                        | Pooling                                     |
| --------------- | ---------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------- |
| Self-hosted     | `postgres://user:pass@localhost:5432/shelf`                                              | `ssl: false`               | `max: 10`                                   |
| AWS RDS         | `postgres://user:pass@<rds-endpoint>:5432/db?sslmode=verify-full`                        | `ssl: { ca }`              | `prepare: true`                             |
| GCP Cloud SQL   | `postgres://user:pass@<cloudsql-ip>:5432/db?sslmode=verify-full`                         | `ssl: { ca, cert, key }`   | Connector or injected client                |
| Aiven for PG    | `postgres://avnadmin:pass@<service>.aivencloud.com:<port>/defaultdb?sslmode=verify-full` | `ssl: { ca }` (project CA) | `max: 10`; PgBouncer port: `prepare: false` |
| Supabase        | `postgres://postgres.<ref>:<pass>@<pooler-host>:6543/postgres?pgbouncer=true`            | `ssl: true`                | `prepare: false` on :6543                   |
| Neon            | `postgres://user:pass@<neon-host>/db?sslmode=require`                                    | `ssl: true`                | `max: 5`; `prepare: false` on pooled        |
| Azure DB for PG | `postgres://user:pass@<server>.postgres.database.azure.com:5432/db?sslmode=verify-full`  | `ssl: { ca }`              | Entra ID via injected client                |

### Verify the database certificate

`sslmode=require` encrypts the connection but does **not** check the server's certificate: anyone in the network path could pose as the database. Use `sslmode=verify-full`, which checks the certificate chain and the host name, and give the server image the CA that signed it:

```sh
DATABASE_URL='postgres://user:pass@host:5432/db?sslmode=verify-full'
DATABASE_CA_FILE=/run/secrets/database-ca.pem   # or DATABASE_CA with the PEM text itself
```

Set one of `DATABASE_CA` (PEM text) or `DATABASE_CA_FILE` (a path); setting both stops the server at startup. The CA is used for MySQL (`mysql://`) the same way. Without either, the server starts as before, and with `sslmode=require`, `prefer` or `allow` it logs one warning that the certificate is not verified. It never refuses to start over it.

With `DATABASE_IAM_*` (RDS or Aurora with IAM tokens) the certificate is always verified, because the IAM token is a credential: against the Amazon RDS root certificates the image bundles, or against `DATABASE_CA` / `DATABASE_CA_FILE` when set (for an RDS Proxy or a custom domain). There is no setting that encrypts without verifying.

Where the CA comes from:

- **AWS RDS:** the [regional or global certificate bundle](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html) (`global-bundle.pem`).
- **GCP Cloud SQL:** the instance's server CA certificate (Console → instance → Connections → Security, or `gcloud sql instances describe`).
- **Azure DB for PostgreSQL:** the CA bundle Microsoft documents for Azure Database for PostgreSQL (the root certificates the server chain ends in).
- **Aiven for PostgreSQL:** the project CA certificate (Console → service overview → CA certificate).
- **Neon, Supabase and others whose certificate chains to a public root:** no CA needed; use `?sslmode=verify-full&sslrootcert=system` to check against the system's CAs.

No code or image change is needed for the system-CA route, and `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` with `?sslmode=verify-full` also works, since it adds your CA to the system's.

See the [`@storyshelf/db-postgres` package reference](/packages/db-postgres/) for full options.

## Related

- [AWS](/guides/deployment/aws/) · [Azure](/guides/deployment/azure/) · [GCP](/guides/deployment/gcp/) — versioned Terraform modules on the published image
- [Docker Compose](/guides/deployment/docker-compose/) — single-host deploy
