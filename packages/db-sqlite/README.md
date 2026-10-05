# @storyshelf/db-sqlite

The default database adapter for self-hosted StoryShelf: SQLite backed by node:sqlite (zero-dependency builtin) and Drizzle ORM, in WAL mode. Zero configuration for a single-node deployment.

## Install

```sh
nub add @storyshelf/db-sqlite
```

or

```sh
npm install @storyshelf/db-sqlite
```

## Quick start

```ts
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createShelfApp } from "@storyshelf/app";
import { createLocalStorage } from "@storyshelf/storage-local";

const database = createSqliteDatabase("./data/shelf.db");

const storage = createLocalStorage("./data");
const app = createShelfApp({ database, storage });
await app.lifecycle.init();
```

## API

### `createSqliteDatabase(path: string): DatabaseAdapter`

Opens (or creates) a SQLite database at `path` and returns a `DatabaseAdapter`. The connection enables WAL journal mode and a 5s busy timeout. Schema migrations run inside the adapter's `lifecycle.init` (via `await app.lifecycle.init()`); teardown via `lifecycle.close` (idempotent).

The returned adapter implements every method of the `DatabaseAdapter` interface (`insert`, `update`, `get`, `remove`, `list`, `count`, `all`) plus `metadata`/`lifecycle` from the shared `Adapter` base.

## Presets (same schema, different driver)

| Subpath                                | Driver                | Install                  | When                                                                                   |
| -------------------------------------- | --------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `@storyshelf/db-sqlite` (root)         | `node:sqlite` builtin | —                        | Default. Single-node VPS/Docker. Zero config.                                          |
| `@storyshelf/db-sqlite/turso`          | `@libsql/client`      | `nub add @libsql/client` | Serverless (Turso cloud, Vercel, Lambda); `file:` URLs and embedded replicas work too. |
| `@storyshelf/db-sqlite/better-sqlite3` | `better-sqlite3`      | `nub add better-sqlite3` | Native sync driver (needs `allowBuilds` for the postinstall).                          |
| `@storyshelf/db-sqlite/bun-sqlite`     | `bun:sqlite` builtin  | — (Bun only)             | Bun runtime.                                                                           |
| `@storyshelf/db-sqlite/d1`             | D1 binding            | — (Workers only)         | Cloudflare Workers (`env.DB`).                                                         |

```ts
import { createTursoDatabase } from "@storyshelf/db-sqlite/turso";

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

## How it fits in

`db-sqlite` is the default `database` option for `createShelfApp` in single-node self-hosted deployments. It implements the same `DatabaseAdapter` interface across the root entry and every preset subpath, so switching databases only means swapping the import.

See `docs/architecture.md` and ADR 0002.
