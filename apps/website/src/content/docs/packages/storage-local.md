---
title: "@storyshelf/storage-local"
description: Store StoryShelf screenshots, diffs, and Storybook archives on a local filesystem.
---

`@storyshelf/storage-local` is the default blob storage adapter for a single-node deployment. It stores screenshots, diff overlays, and uploaded Storybook archives below one data directory.

## Install

```sh
nub add @storyshelf/storage-local
```

[![JSR](https://jsr.io/badges/@storyshelf/storage-local)](https://jsr.io/@storyshelf/storage-local) [![JSR Score](https://jsr.io/badges/@storyshelf/storage-local/score)](https://jsr.io/@storyshelf/storage-local)

- [npm package](https://www.npmjs.com/package/@storyshelf/storage-local) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/storage-local) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/storage-local/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/storage-local) — package directory on `main`.

## Configure

```ts
import { createLocalStorage } from "@storyshelf/storage-local";

const storage = createLocalStorage("./data");
const app = createShelfRouter({ database, storage });
```

Directories are created as needed. Paths are resolved beneath the configured data directory; attempts to escape it are rejected. The adapter implements `StorageAdapter`: `read`, `write`, `delete`, `exists`, and `list(prefix)`.

## When to use it

Use local storage with [SQLite](../db-sqlite/) for a simple single-node deployment. For cloud or multi-node deployments where instances need shared objects, switch to [S3 storage](../storage-s3/) without changing the core router.
