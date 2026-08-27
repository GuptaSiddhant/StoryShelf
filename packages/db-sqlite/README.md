# @storyshelf/db-sqlite

The default database adapter for self-hosted StoryShelf: SQLite backed by better-sqlite3 and Drizzle ORM, in WAL mode. Zero configuration for a single-node deployment.

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
import { createShelfRouter } from "@storyshelf/core";
import { createLocalStorage } from "@storyshelf/storage-local";

const database = createSqliteDatabase("./data/shelf.db");
await database.migrate();

const storage = createLocalStorage("./data");
const app = createShelfRouter({ database, storage });
```

## API

### `createSqliteDatabase(path: string): DatabaseAdapter`

Opens (or creates) a SQLite database at `path` and returns a `DatabaseAdapter`. The connection enables WAL journal mode and a 5s busy timeout. Call `migrate()` before use to apply the schema (shared DDL from `@storyshelf/core`).

The returned adapter implements every method of the `DatabaseAdapter` interface (`insert`, `update`, `get`, `remove`, `list`, `count`, `all`, `migrate`, `close`).

## How it fits in

`db-sqlite` is the default `database` option for `createShelfRouter` in single-node self-hosted deployments. It implements the same `DatabaseAdapter` interface and shares the same Drizzle schema as `@storyshelf/db-turso`, so switching to a serverless database only means swapping this adapter.

See `docs/architecture.md` and ADR 0002.
