---
title: "@storyshelf/db-sqlite"
description: The zero-configuration SQLite database adapter for single-node StoryShelf deployments.
---

`@storyshelf/db-sqlite` is the default database adapter for self-hosted StoryShelf. It uses node:sqlite (zero-dependency builtin) and Drizzle ORM, enables WAL mode, and stores the database in one local file.

## Install

```sh
nub add @storyshelf/db-sqlite
```

[![JSR](https://jsr.io/badges/@storyshelf/db-sqlite)](https://jsr.io/@storyshelf/db-sqlite) [![JSR Score](https://jsr.io/badges/@storyshelf/db-sqlite/score)](https://jsr.io/@storyshelf/db-sqlite)

- [npm package](https://www.npmjs.com/package/@storyshelf/db-sqlite) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/db-sqlite) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/db-sqlite/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/db-sqlite) — package directory on `main`.

## Configure

```ts
import { createSqliteDatabase } from "@storyshelf/db-sqlite";

const database = createSqliteDatabase("./data/shelf.db");
```

Migrations run inside the adapter's `lifecycle.init` — await them via `app.lifecycle.init()` after creating the router, and close via `app.lifecycle.close()` on shutdown. The adapter implements `DatabaseAdapter`: `insert`, `update`, `get`, `remove`, `list`, `count`, and `all`, plus `metadata`/`lifecycle` from the shared `Adapter` base.

## When to use it

Use SQLite for a single-node deployment or local development. Pair it with [local storage](../storage-local/) for the simplest self-hosted setup. The schema and adapter contract are shared with [Turso](../db-turso/), so moving to a serverless database does not change the rest of the application.
