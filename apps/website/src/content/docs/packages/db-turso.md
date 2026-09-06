---
title: "@storyshelf/db-turso"
description: A serverless Turso/libSQL database adapter for cloud StoryShelf deployments.
---

`@storyshelf/db-turso` connects StoryShelf to Turso or another libSQL service through `@libsql/client`. It uses the same Drizzle schema and `DatabaseAdapter` contract as SQLite.

## Install

```sh
nub add @storyshelf/db-turso
```

[![JSR](https://jsr.io/badges/@storyshelf/db-turso)](https://jsr.io/@storyshelf/db-turso) [![JSR Score](https://jsr.io/badges/@storyshelf/db-turso/score)](https://jsr.io/@storyshelf/db-turso)

- [npm package](https://www.npmjs.com/package/@storyshelf/db-turso) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/db-turso) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/db-turso/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/db-turso) — package directory on `main`.

## Configure

```ts
import { createTursoDatabase } from "@storyshelf/db-turso";

const database = createTursoDatabase({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

`url` is required and `authToken` is optional for local or unsecured libSQL servers. Migrations run inside the adapter's `lifecycle.init` — await them via `app.lifecycle.init()` after creating the router.

## When to use it

Choose this adapter for serverless or cloud environments such as Vercel, Cloudflare Workers, or AWS Lambda. It is a drop-in replacement for [SQLite](../db-sqlite/); only the database construction changes. Pair it with [S3-compatible storage](../storage-s3/) when instances do not share a local filesystem.
