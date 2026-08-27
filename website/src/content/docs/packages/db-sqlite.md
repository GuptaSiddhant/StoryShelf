---
title: "@storyshelf/db-sqlite"
description: The zero-configuration SQLite database adapter for single-node StoryShelf deployments.
---

`@storyshelf/db-sqlite` is the default database adapter for self-hosted StoryShelf. It uses better-sqlite3 and Drizzle ORM, enables WAL mode, and stores the database in one local file.

## Install

```sh
nub add @storyshelf/db-sqlite
```

## Configure

```ts
import { createSqliteDatabase } from "@storyshelf/db-sqlite";

const database = createSqliteDatabase("./data/shelf.db");
await database.migrate();
```

Call `migrate()` before creating or serving the router. Call `close()` during shutdown. The adapter implements `DatabaseAdapter`: `insert`, `update`, `get`, `remove`, `list`, `count`, `all`, `migrate`, and `close`.

## When to use it

Use SQLite for a single-node deployment or local development. Pair it with [local storage](../storage-local/) for the simplest self-hosted setup. The schema and adapter contract are shared with [Turso](../db-turso/), so moving to a serverless database does not change the rest of the application.
