# @storyshelf/db-postgres

Postgres database adapter for StoryShelf (postgres.js + Drizzle). Connects to AWS RDS, GCP Cloud SQL, Supabase, Neon, Azure Database, or self-hosted Postgres. See [Deployment](../../apps/website/src/content/docs/guides/deployment.md) for provider recipes.

## Install

```sh
nub add @storyshelf/db-postgres
```

## Quick start (self-hosted)

```ts
import { createPostgresDatabase } from "@storyshelf/db-postgres";

const db = createPostgresDatabase({ url: "postgres://user:pass@localhost:5432/shelf" });
```

For managed providers, pass `ssl`, `prepare`, and pool options via `options` or inject a preconfigured `client` (see `PostgresDatabaseOptions`).

## Configure

```ts
import { createPostgresDatabase } from "@storyshelf/db-postgres";

const database = createPostgresDatabase({
  url: process.env.DATABASE_URL!,
});
```

`url` (or `connectionString`) is required unless a preconfigured `client` is injected. Optional `postgres.js` tuning is forwarded via `ssl`, `prepare`, `max`, `idleTimeout`, and `connectTimeout`. Migrations run inside the adapter's `lifecycle.setup` — await them via `app.lifecycle.setup()` after creating the router, and close via `app.lifecycle.teardown()` on shutdown. The adapter implements `DatabaseAdapter`: `insert`, `update`, `get`, `remove`, `list`, `count`, and `all`, plus `metadata`/`lifecycle` from the shared `Adapter` base.

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

| Provider                      | Connection string shape                                                                                             | TLS                                                                                  | Pooling notes                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Self-hosted                   | `postgres://user:pass@localhost:5432/shelf`                                                                         | `ssl: false` or omit for plain TCP; set `ssl: true` if the server enforces TLS       | Default `max: 10`; tune `max` / `idleTimeout` for your host                                                                     |
| AWS RDS                       | `postgres://user:pass@<rds-endpoint>:5432/db?sslmode=require`                                                       | `ssl: true` for default CA; or `ssl: { ca: rdsCaBundle }` for a custom RDS CA bundle | IAM auth via injected `client` with a refreshed token (see below); `prepare: true` (default) is fine                            |
| GCP Cloud SQL                 | `postgres://user:pass@<cloudsql-ip>:5432/db`                                                                        | `ssl: { ca, cert, key }` for mutual TLS (Cloud SQL server + client certs)            | Use Cloud SQL Connector or inject a `client` with IAM credentials; mutual TLS required when not using the proxy                 |
| Supabase                      | `postgres://postgres.<ref>:<pass>@<pooler-host>:6543/postgres?pgbouncer=true` (pooler) or `:5432/postgres` (direct) | `ssl: true` (Supabase enforces TLS)                                                  | **PgBouncer (port `6543`, transaction mode) requires `prepare: false`**; direct connections on `5432` can leave `prepare: true` |
| Neon                          | `postgres://user:pass@<neon-host>/db?sslmode=require`                                                               | `ssl: true`                                                                          | Serverless pooler — keep `max` low (e.g. `max: 5`); pooled endpoints via PgBouncer need `prepare: false`                        |
| Azure Database for PostgreSQL | `postgres://user:pass@<server>.postgres.database.azure.com:5432/db?sslmode=require`                                 | `ssl: true`                                                                          | Microsoft Entra ID (IAM) via injected `client` with an access token; otherwise password auth works with default pooling         |

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
