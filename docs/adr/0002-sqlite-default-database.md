# ADR 0002: SQLite + Turso for Database

## Status

Accepted

## Context

StoryShelf needs a database for projects, builds, snapshots, baselines, and tokens. The tool is self-hosted and should require zero infrastructure beyond the binary itself.

StoryBooker used a local JSON file (`createLocalFileDatabaseAdapter`) for development and DynamoDB/CosmosDB/Firestore for production. The JSON file broke with concurrent writes. The cloud databases required account setup, credentials, and per-project table creation.

## Decision

Two database implementations, same Drizzle schema:

1. **SQLite** (default, self-hosted): `better-sqlite3` + Drizzle ORM. Zero config. WAL mode.
2. **Turso/libSQL** (serverless/cloud): `@libsql/client` + Drizzle ORM. Works on Vercel, Cloudflare Workers, Lambda where SQLite can't run.

### Schema

The full schema is defined once in `docs/architecture.md` (Entity Model). Both drivers share a single Drizzle schema that mirrors it 1:1 (SQLite via `drizzle-orm/better-sqlite3`, Turso via `drizzle-orm/libsql`).

### SQLite connection (local)

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const sqlite = new Database("data/shelf.db");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
const db = drizzle(sqlite, { schema });
```

### Turso connection (serverless)

```typescript
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,      // "libsql://your-db.turso.io"
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = drizzle(client, { schema });
```

### Migration path

```
SQLite (local, Docker/VPS)
  → Turso (serverless: Vercel, Cloudflare Workers)
    → PostgreSQL (if you ever outgrow both)
```

Drizzle supports all three with the same schema definitions. The adapter interface doesn't change — just the connection factory.

## Consequences

**Positive:**
- Zero configuration on VPS/Docker — no server, no connection string, no credentials
- Single file on disk — `data/shelf.db` — easy backup, easy migration
- WAL mode handles concurrent reads + single writer perfectly for this use case
- Turso gives sub-millisecond reads via embedded replicas on long-lived servers
- Turso HTTP client mode works in any edge runtime (Vercel, Cloudflare Workers)
- Drizzle ORM gives type-safe schema and queries with minimal overhead
- Same schema works for SQLite, Turso, and PostgreSQL — future-proof

**Negative:**
- SQLite single writer: cannot scale to multiple server processes (fine for single-tenant)
- Turso free tier: 500 databases, 5GB storage, 500M reads/month (sufficient for most teams)
- Turso write latency: 15-50ms vs SQLite's 0.05ms (acceptable for review workflows, not for high-throughput writes)

## Amendment (2026-09-05): better-sqlite3 → node:sqlite

The SQLite driver moved from `better-sqlite3` to the `node:sqlite` builtin
(`DatabaseSync`) via `drizzle-orm/sqlite-proxy` (stable drizzle 0.44.x ships no
native `node:sqlite` driver). `createSqliteDatabase(path)` signature,
WAL mode, and the shared schema are unchanged; zero native dependencies remain.
The code samples above show the original driver and are kept for history —
see `packages/db-sqlite/src/index.ts` for the current wiring. Native
`drizzle-orm/node-sqlite` (v1 beta line) will replace the proxy shim once GA.

## Why Not PostgreSQL

PostgreSQL is the right choice for multi-tenant SaaS. StoryShelf is a single-tenant self-hosted tool. SQLite has zero operational overhead: no server to manage, no credentials to rotate, no connection pooling to tune. The entire database is a file.

If a user outgrows SQLite (unlikely), Turso is the first step. PostgreSQL is the nuclear option, and Drizzle supports it.
