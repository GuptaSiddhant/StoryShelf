---
title: "@storyshelf/db-postgres"
description: Postgres database adapter for StoryShelf via postgres.js and Drizzle ORM — self-hosted, RDS, Cloud SQL, Supabase, Neon, and Azure.
---

`@storyshelf/db-postgres` connects StoryShelf to Postgres through `postgres.js` and Drizzle ORM. It implements the same `DatabaseAdapter` contract as [SQLite](../db-sqlite/) and [Turso](../db-turso/), so the rest of the application does not change when switching databases.

## Install

```sh
nub add @storyshelf/db-postgres
```

[![JSR](https://jsr.io/badges/@storyshelf/db-postgres)](https://jsr.io/@storyshelf/db-postgres) [![JSR Score](https://jsr.io/badges/@storyshelf/db-postgres/score)](https://jsr.io/@storyshelf/db-postgres)

- [npm package](https://www.npmjs.com/package/@storyshelf/db-postgres) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/db-postgres) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/db-postgres/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/db-postgres) — package directory on `main`.

## Configure

```ts
import { createPostgresDatabase } from "@storyshelf/db-postgres";

const database = createPostgresDatabase({
  url: process.env.DATABASE_URL!,
});
```

`url` (or `connectionString`) is required unless a preconfigured `client` is injected. Optional `postgres.js` tuning is forwarded via `ssl`, `prepare`, `max`, `idleTimeout`, and `connectTimeout`. Migrations run inside the adapter's `lifecycle.init` — await them via `app.lifecycle.init()` after creating the router, and close via `app.lifecycle.close()` on shutdown. The adapter implements `DatabaseAdapter`: `insert`, `update`, `get`, `remove`, `list`, `count`, and `all`, plus `metadata`/`lifecycle` from the shared `Adapter` base.

```ts
// With explicit pooling and TLS
const database = createPostgresDatabase({
  url: process.env.DATABASE_URL!,
  ssl: true,
  prepare: true,
  max: 10,
  idleTimeout: 30,
  connectTimeout: 10,
});
```

## Provider recipes

All providers speak the standard Postgres wire protocol. Pick the connection string and options for your host.

| Provider | Connection string shape | TLS | Pooling notes |
|----------|-------------------------|-----|---------------|
| Self-hosted | `postgres://user:pass@localhost:5432/shelf` | `ssl: false` or omit for plain TCP; set `ssl: true` if the server enforces TLS | Default `max: 10`; tune `max` / `idleTimeout` for your host |
| AWS RDS | `postgres://user:pass@<rds-endpoint>:5432/db?sslmode=require` | `ssl: true` for default CA; or `ssl: { ca: rdsCaBundle }` for a custom RDS CA bundle | IAM auth via injected `client` with a refreshed token (see below); `prepare: true` (default) is fine |
| GCP Cloud SQL | `postgres://user:pass@<cloudsql-ip>:5432/db` | `ssl: { ca, cert, key }` for mutual TLS (Cloud SQL server + client certs) | Use Cloud SQL Connector or inject a `client` with IAM credentials; mutual TLS required when not using the proxy |
| Supabase | `postgres://postgres.<ref>:<pass>@<pooler-host>:6543/postgres?pgbouncer=true` (pooler) or `:5432/postgres` (direct) | `ssl: true` (Supabase enforces TLS) | **PgBouncer (port `6543`, transaction mode) requires `prepare: false`**; direct connections on `5432` can leave `prepare: true` |
| Neon | `postgres://user:pass@<neon-host>/db?sslmode=require` | `ssl: true` | Serverless pooler — keep `max` low (e.g. `max: 5`); pooled endpoints via PgBouncer need `prepare: false` |
| Azure Database for PostgreSQL | `postgres://user:pass@<server>.postgres.database.azure.com:5432/db?sslmode=require` | `ssl: true` | Microsoft Entra ID (IAM) via injected `client` with an access token; otherwise password auth works with default pooling |

## Client injection (IAM and advanced TLS)

When `client` is supplied, all other connection options are ignored and the caller owns the client lifecycle. Use this for IAM token refresh or pre-configured TLS:

```ts
import postgres from "postgres";
import { createPostgresDatabase } from "@storyshelf/db-postgres";

// Example: IAM — fetch a fresh token before connecting (RDS, Azure Entra ID, etc.)
const client = postgres(process.env.DATABASE_URL!, {
  ssl: true,
  // password is the IAM token; refresh by recreating the client on rotation
});

const database = createPostgresDatabase({ client });
```

This is also the hook for hermetic tests and for custom CA bundles that are loaded from disk or a secrets manager.

## When to use it

Choose Postgres when you need a managed relational database or already run Postgres for your team. It is a drop-in replacement for [SQLite](../db-sqlite/) and [Turso](../db-turso/); only the database construction changes. Pair it with [local storage](../storage-local/) for single-node deployments or [S3-compatible storage](../storage-s3/) when instances do not share a filesystem.
