# ADR 0002: Database

## Status

Accepted

Supersedes (archived): ADR 0002

## Context

StoryShelf stores projects, builds, snapshots, baselines, comments, tokens and the capture job
queue (ADR 0006). The tool is self-hosted and must need no infrastructure beyond a file by default,
while allowing serverless and managed databases for larger deployments. The predecessor used a JSON
file that broke under concurrent writes, and cloud document stores that needed accounts, credentials
and per-project table creation.

## Decision

1. **One schema, many drivers.** A single Drizzle schema, mirroring the entity model in
   `docs/architecture.md`, backs every database package. Packages differ in driver and connection
   factory, not in schema or queries. The `DatabaseAdapter` interface does not change between them,
   and exposes typed table handles through `tables` so that code outside the database packages never
   imports a dialect-specific table type.
2. **SQLite is the default**, in `@storyshelf/db-sqlite`: the `node:sqlite` builtin
   (`DatabaseSync`) through `drizzle-orm/sqlite-proxy`, so there are no native dependencies. It runs
   in WAL mode with a busy timeout and needs zero configuration (`createSqliteDatabase(path)`).
   The proxy shim is replaced by the native Drizzle `node:sqlite` driver when it is generally
   available.
3. **SQLite presets** are subpaths of the same package: `./turso` (libSQL over the network, for
   serverless hosts, optional `@libsql/client` peer), `./better-sqlite3` (native, optional peer),
   `./bun-sqlite` (Bun only) and `./d1` (Cloudflare D1 binding, no peer).
4. **Postgres** lives in `@storyshelf/db-postgres`: `postgres.js` by default, with subpaths `./pg`
   (node-postgres, pooler-safe), `./neon`, `./neon-http`, `./vercel` and `./pglite` (embedded WASM).
5. **MySQL and MariaDB** live in `@storyshelf/db-mysql`: `mysql2` by default, with subpaths
   `./planetscale` and `./tidb` for serverless MySQL.
6. **Each package ships DDL** (`CREATE TABLE IF NOT EXISTS`) and migrations for its dialect, so a new
   table is added in all three packages together.
7. **Hosting-only deployments may use any preset; D1 is hosting-only.** A deployment with `testing`
   needs a long-running server (ADR 0006), so the Workers-only D1 binding cannot back one. Turso over
   the network can, and remains the way to host Storybooks on serverless platforms.
8. **Which presets support several instances.** With `testing`, the database is also the capture
   queue (ADR 0006). Postgres (`postgres.js`, `pg`, Neon, Vercel), MySQL and Turso support any number
   of instances on any hosts, and `neon-http` works because nothing relies on interactive
   transactions. Local-file SQLite (`node:sqlite`, `better-sqlite3`, `bun-sqlite`) and the embedded
   `pglite` support the processes of one host.

## Consequences

**Positive**

- Zero configuration for a VPS or Docker: no server, no credentials, one file (`data/shelf.db`) to
  back up.
- WAL handles concurrent reads with a single writer, which fits a review workflow.
- Moving from a file to Turso to Postgres or MySQL changes the factory, not the schema or models.
- Drizzle gives a type-safe schema and queries with little overhead.

**Negative**

- Local-file SQLite has a single writer and cannot serve multiple hosts.
- Turso writes cost milliseconds more than a local file, which is acceptable for review but not for
  high-throughput writes.
- Every schema change is made in three dialect packages, and adding a table to `Tables` is a
  breaking change for third-party `DatabaseAdapter` implementations.

## Alternatives rejected

| Alternative                                            | Why rejected                                                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| JSON file database                                     | Corrupts under concurrent writes                                                                                             |
| Cloud document stores (DynamoDB, Cosmos DB, Firestore) | Account setup, credentials and per-project table creation for a self-hosted tool                                             |
| PostgreSQL only                                        | Operational overhead (server, credentials, pooling) for a single-tenant self-hosted default; it stays available as a package |
| `better-sqlite3` as the default driver                 | Native dependency; `node:sqlite` removes it                                                                                  |

## Open questions

- Whether `db-sqlite` should adopt Drizzle's native `node:sqlite` driver as soon as it reaches a
  stable release, or wait for the next major.
