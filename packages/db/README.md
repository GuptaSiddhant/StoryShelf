# @storyshelf/db

Database adapters for StoryShelf, one subpath each: **SQLite** (`node:sqlite`, the zero-configuration default), **Postgres** and **MySQL/MariaDB**, with their driver and cloud presets (Turso, better-sqlite3, Bun, D1, pg, Neon, Vercel, PGlite, RDS IAM, PlanetScale, TiDB). Every driver is an optional peer that only its own subpath loads, so a SQLite server never installs a Postgres or MySQL client.

## Install

```sh
nub add @storyshelf/db
```

or

```sh
npm install @storyshelf/db
```

Then install only the driver your subpath needs (SQLite on `node:sqlite` needs none):

| Subpath                                | Driver peer                                                |
| -------------------------------------- | ---------------------------------------------------------- |
| `@storyshelf/db/sqlite`                | — (`node:sqlite` builtin)                                  |
| `@storyshelf/db/sqlite/turso`          | `@libsql/client`                                           |
| `@storyshelf/db/sqlite/better-sqlite3` | `better-sqlite3`                                           |
| `@storyshelf/db/sqlite/bun-sqlite`     | — (Bun only)                                               |
| `@storyshelf/db/sqlite/d1`             | — (Cloudflare Workers only)                                |
| `@storyshelf/db/postgres`              | `postgres`                                                 |
| `@storyshelf/db/postgres/pg`           | `pg`                                                       |
| `@storyshelf/db/postgres/neon`         | `@neondatabase/serverless`                                 |
| `@storyshelf/db/postgres/neon-http`    | `@neondatabase/serverless`                                 |
| `@storyshelf/db/postgres/vercel`       | `@vercel/postgres`                                         |
| `@storyshelf/db/postgres/pglite`       | `@electric-sql/pglite`                                     |
| `@storyshelf/db/postgres/rds-iam`      | `pg`, `@aws-sdk/rds-signer`                                |
| `@storyshelf/db/mysql`                 | `mysql2`                                                   |
| `@storyshelf/db/mysql/planetscale`     | `mysql2`, `@planetscale/database`                          |
| `@storyshelf/db/mysql/tidb`            | `mysql2`, `@tidbcloud/serverless`                          |

## SQLite (/sqlite)

The default database adapter for self-hosted StoryShelf: SQLite backed by `node:sqlite` (zero-dependency builtin) and Drizzle ORM, in WAL mode. Zero configuration for a single-node deployment.

### Quick start

```ts
import { createSqliteDatabase } from "@storyshelf/db/sqlite";
import { createShelfApp } from "@storyshelf/app";
import { createLocalStorage } from "@storyshelf/core/storage/local";

const database = createSqliteDatabase("./data/shelf.db");

const storage = createLocalStorage("./data");
const app = createShelfApp({ database, storage });
await app.lifecycle.setup();
```

### API

#### `createSqliteDatabase(path: string): DatabaseAdapter`

Opens (or creates) a SQLite database at `path` and returns a `DatabaseAdapter`. The connection enables WAL journal mode and a 5s busy timeout. Schema migrations run inside the adapter's `lifecycle.setup` (via `await app.lifecycle.setup()`); teardown via `lifecycle.teardown` (idempotent).

The returned adapter implements every method of the `DatabaseAdapter` interface (`insert`, `update`, `get`, `remove`, `list`, `count`, `all`) plus `metadata`/`lifecycle` from the shared `Adapter` base.

### Presets (same schema, different driver)

| Subpath                                | Driver                | Install                      | When                                                                                   |
| -------------------------------------- | --------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| `@storyshelf/db/sqlite`         | `node:sqlite` builtin | —                            | Default. Single-node VPS/Docker. Zero config.                                          |
| `@storyshelf/db/sqlite/turso`          | `@libsql/client`      | `npm install @libsql/client` | Serverless (Turso cloud, Vercel, Lambda); `file:` URLs and embedded replicas work too. |
| `@storyshelf/db/sqlite/better-sqlite3` | `better-sqlite3`      | `npm install better-sqlite3` | Native sync driver (needs `allowBuilds` for the postinstall).                          |
| `@storyshelf/db/sqlite/bun-sqlite`     | `bun:sqlite` builtin  | — (Bun only)                 | Bun runtime.                                                                           |
| `@storyshelf/db/sqlite/d1`             | D1 binding            | — (Workers only)             | Cloudflare Workers (`env.DB`). Hosts Storybooks only: it cannot back `testing.runner`. |

```ts
import { createTursoDatabase } from "@storyshelf/db/sqlite/turso";

const database = createTursoDatabase({
  url: process.env["TURSO_DATABASE_URL"],
  authToken: process.env["TURSO_AUTH_TOKEN"],
});
```

All presets accept an injected `client` instead of connection options (the caller then owns teardown); all except D1 also accept plain connection options and throw on missing/invalid input. Driver peers are optional: consumers only install their backend's client.

> Do not add any of drizzle-orm's peer packages as a direct dependency of a
> single workspace package — drizzle-orm resolves a distinct copy per unique
> peer set, which splits the shared `Table`/`SQL` types. Preset types that a
> peer would provide live in colocated `*-ambient.d.ts` files instead.

## Postgres (/postgres)

Postgres adapter (postgres.js + Drizzle). Connects to AWS RDS, GCP Cloud SQL, Supabase, Neon, Azure Database, or self-hosted Postgres. See [Deployment](../../apps/website/src/content/docs/guides/deployment.md) for provider recipes.

### Quick start (self-hosted)

```ts
import { createPostgresDatabase } from "@storyshelf/db/postgres";

const db = createPostgresDatabase({ url: "postgres://user:pass@localhost:5432/shelf" });
```

For managed providers, pass `ssl`, `prepare`, and pool options via `options` or inject a preconfigured `client` (see `PostgresDatabaseOptions`).

### Configure

```ts
import { createPostgresDatabase } from "@storyshelf/db/postgres";

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

### Provider recipes

All providers speak the standard Postgres wire protocol. Pick the connection string and options for your host.

| Provider                      | Connection string shape                                                                                             | TLS                                                                                  | Pooling notes                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Self-hosted                   | `postgres://user:pass@localhost:5432/shelf`                                                                         | `ssl: false` or omit for plain TCP; set `ssl: true` if the server enforces TLS       | Default `max: 10`; tune `max` / `idleTimeout` for your host                                                                     |
| AWS RDS                       | `postgres://user:pass@<rds-endpoint>:5432/db?sslmode=require`                                                       | `ssl: true` for default CA; or `ssl: { ca: rdsCaBundle }` for a custom RDS CA bundle | IAM auth via injected `client` with a refreshed token (see below); `prepare: true` (default) is fine                            |
| GCP Cloud SQL                 | `postgres://user:pass@<cloudsql-ip>:5432/db`                                                                        | `ssl: { ca, cert, key }` for mutual TLS (Cloud SQL server + client certs)            | Use Cloud SQL Connector or inject a `client` with IAM credentials; mutual TLS required when not using the proxy                 |
| Supabase                      | `postgres://postgres.<ref>:<pass>@<pooler-host>:6543/postgres?pgbouncer=true` (pooler) or `:5432/postgres` (direct) | `ssl: true` (Supabase enforces TLS)                                                  | **PgBouncer (port `6543`, transaction mode) requires `prepare: false`**; direct connections on `5432` can leave `prepare: true` |
| Neon                          | `postgres://user:pass@<neon-host>/db?sslmode=require`                                                               | `ssl: true`                                                                          | Serverless pooler — keep `max` low (e.g. `max: 5`); pooled endpoints via PgBouncer need `prepare: false`                        |
| Azure Database for PostgreSQL | `postgres://user:pass@<server>.postgres.database.azure.com:5432/db?sslmode=require`                                 | `ssl: true`                                                                          | Microsoft Entra ID (IAM) via injected `client` with an access token; otherwise password auth works with default pooling         |

### PGlite on Node 24

`@storyshelf/db/postgres/pglite` runs Postgres as WebAssembly inside the Node process. Node 24's V8 can abort the process (`Check failed: jit_page_->allocations_.erase(addr) == 1` or `jit_page.has_value()`, exit code 133) when it frees the wasm code of a PGlite instance that was closed ([nodejs/node#66366](https://github.com/nodejs/node/issues/66366); the fix is in V8 and Node 22 and 26, but not yet in a 24.x release). A server that opens one PGlite for its whole life does not free that code, so it does not hit the bug. If one process opens and closes many PGlite instances (as test suites do), start Node with `--no-wasm-code-gc`, for example `node --no-wasm-code-gc node_modules/@storyshelf/app/dist/bin.mjs serve` or a Vitest `execArgv`. Node refuses this flag in `NODE_OPTIONS`.

### RDS and Aurora with IAM authentication

`@storyshelf/db/postgres/rds-iam` connects to RDS or Aurora Postgres with a short-lived IAM token instead of a password, so there is nothing to rotate. Install the optional peers (`pg` and `@aws-sdk/rds-signer`); the standard AWS credential chain applies (ECS task role, instance role, web identity).

```ts
import { createRdsIamDatabase } from "@storyshelf/db/postgres/rds-iam";

const database = createRdsIamDatabase({
  host: "mydb.cluster-abc.eu-west-1.rds.amazonaws.com",
  database: "storyshelf",
  user: "storyshelf_app", // GRANT rds_iam TO storyshelf_app;
  region: "eu-west-1",
});
```

- **A fresh token for every new connection.** Tokens live 15 minutes; the pool asks for one each time it opens a connection, so it never reuses a stale one. An open connection stays valid after its token expires.
- **The server certificate is verified by default.** The IAM token is a credential, so the preset checks the database's certificate against the Amazon RDS root certificates it bundles (AWS's global bundle, every region, and the GovCloud bundle for `us-gov-*`). Pass `ca` (PEM, or an array) to trust your own instead, for a proxy or a custom domain. There is no option to encrypt without verifying, because anyone who can intercept the connection could then take the token; a blank `ca` is refused. The server image reads `SHELF_DATABASE_CA` / `SHELF_DATABASE_CA_FILE` for this, the same variables it uses for `DATABASE_URL`.
- **Tokens stay out of logs and errors.** A signer failure is reported without the token, and `redactSecrets` removes presigned `X-Amz-*` values.
- **A missing `@aws-sdk/rds-signer` fails at startup** with an install hint.
- The database user needs the `rds_iam` role and the task role needs `rds-db:connect` on the database user.

### Client injection (IAM and advanced TLS)

When `client` is supplied, all other connection options are ignored and the caller owns the client lifecycle. Use this for IAM token refresh or pre-configured TLS:

```ts
import postgres from "postgres";
import { createPostgresDatabase } from "@storyshelf/db/postgres";

// Example: IAM — fetch a fresh token before connecting (RDS, Azure Entra ID, etc.)
const client = postgres(process.env.DATABASE_URL!, {
  ssl: true,
  // password is the IAM token; refresh by recreating the client on rotation
});

const database = createPostgresDatabase({ client });
```

This is also the hook for hermetic tests and for custom CA bundles that are loaded from disk or a secrets manager.

## MySQL (/mysql)

MySQL/MariaDB adapter (mysql2 + Drizzle). PlanetScale and TiDB presets are available via the `/mysql/planetscale` and `/mysql/tidb` subpaths.

### Usage

```ts
import { createMysqlDatabase } from "@storyshelf/db/mysql";

const db = createMysqlDatabase({ url: "mysql://user:pass@localhost:3306/shelf" });
```

### Configure

```ts
import { createMysqlDatabase } from "@storyshelf/db/mysql";

const database = createMysqlDatabase({
  url: process.env.DATABASE_URL!, // mysql://user:pass@host:3306/shelf
});
```

Provide one of:

- `url` / `connectionString` — a MySQL connection URL.
- `host` (with `port`, `user`, `password`, `database`, `ssl`, `connectionLimit`) — discrete options; the pool defaults to 10 connections.
- `client` — a preconfigured `mysql2` pool or connection. When you inject a client you own its lifecycle; the adapter only closes pools it created.

Migrations run inside the adapter's `migrate` hook — await them via `app.lifecycle.setup()` after creating the app. The adapter implements `DatabaseAdapter` (`insert`, `update`, `get`, `remove`, `list`, `count`, `all`) plus a `ping` used by health checks.

### Presets

Two preset entry points exist so generated servers and the CLI can import a provider-named factory:

```ts
import { createPlanetscaleDatabase } from "@storyshelf/db/mysql/planetscale";
import { createTidbDatabase } from "@storyshelf/db/mysql/tidb";
```

Today both are thin aliases over the same `mysql2` pool: PlanetScale and TiDB Serverless speak the MySQL wire protocol, so the standard options above work unchanged (use `ssl` as your provider requires). They take the same options as `createMysqlDatabase`. Neither provides build retention (see below): their locking was never proven.

### Build retention

With `testing` on, build purge and branch GC need the fenced retention lifecycle (ADR 0039). This
adapter provides it only where it was proven against a real server:

- `createMysqlDatabase` with a **pool** (a `url`, `host` options, or an injected `mysql2` `Pool`);
- on **MySQL 8**, with the lifecycle tables on **InnoDB** and the binary log, if enabled, not
  `STATEMENT`-based (`ROW`, the default, or `MIXED`).

Each lifecycle operation borrows its own pooled connection and runs at `READ COMMITTED`, whatever
the server's default isolation. Anything else keeps retention **off** (no automatic build deletion or
branch GC; admin purge answers `503`) and logs the reason once at boot: the PlanetScale and TiDB
presets, an injected single `Connection`, MariaDB, TiDB, Vitess, or another MySQL version.

Upgrading: the migration adds `builds.retention_state` (default `available`) and four lifecycle
tables; nothing is dropped, so the previous release keeps running on the new schema. The first boot
then pins the source build of every baseline before it turns retention on. Upgrade **every**
instance that shares the database before relying on purge: an older instance writes baselines
without the fence. A baseline whose recorded source build is being deleted or belongs to another
project pauses retention instead (the System page names both ids); fix the data and restart.

## How it fits in

Each subpath is a `database` option for `createShelfApp`. All of them implement the same `DatabaseAdapter` interface across the root entry and every preset, so switching databases only means swapping the import (and the driver you install).

See `docs/architecture/` and ADR 0002.

## License

MIT
