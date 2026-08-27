---
title: "@storyshelf/db-turso"
description: A serverless Turso/libSQL database adapter for cloud StoryShelf deployments.
---

`@storyshelf/db-turso` connects StoryShelf to Turso or another libSQL service through `@libsql/client`. It uses the same Drizzle schema and `DatabaseAdapter` contract as SQLite.

## Install

```sh
nub add @storyshelf/db-turso
```

## Configure

```ts
import { createTursoDatabase } from "@storyshelf/db-turso";

const database = createTursoDatabase({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
await database.migrate();
```

`url` is required and `authToken` is optional for local or unsecured libSQL servers. Run `migrate()` before serving requests.

## When to use it

Choose this adapter for serverless or cloud environments such as Vercel, Cloudflare Workers, or AWS Lambda. It is a drop-in replacement for [SQLite](../db-sqlite/); only the database construction changes. Pair it with [S3-compatible storage](../storage-s3/) when instances do not share a local filesystem.
