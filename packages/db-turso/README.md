# @storyshelf/db-turso

The serverless database adapter for StoryShelf: Turso/libSQL backed by `@libsql/client` and Drizzle ORM. The same schema and queries as `db-sqlite`, but on a driver that runs on Vercel, Cloudflare Workers, and AWS Lambda.

## Install

```sh
nub add @storyshelf/db-turso
```

or

```sh
npm install @storyshelf/db-turso
```

## Quick start

```ts
import { createTursoDatabase } from "@storyshelf/db-turso";
import { createShelfRouter } from "@storyshelf/core";

const database = createTursoDatabase({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
await database.migrate();

const app = createShelfRouter({ database, storage });
```

## API

### `createTursoDatabase(options: { url: string; authToken?: string }): DatabaseAdapter`

Creates a libSQL client and returns a `DatabaseAdapter`. `url` is the Turso database URL; `authToken` is the optional authentication token. Call `migrate()` before use to apply the schema.

The returned adapter implements every method of the `DatabaseAdapter` interface (`insert`, `update`, `get`, `remove`, `list`, `count`, `all`, `migrate`, `close`).

## How it fits in

`db-turso` is the `database` option for `createShelfRouter` when running serverless or in the cloud. It shares the same Drizzle schema and `DatabaseAdapter` interface as `@storyshelf/db-sqlite`, so the rest of the stack is identical regardless of which driver you pick.

See `docs/architecture.md` and ADR 0002.
