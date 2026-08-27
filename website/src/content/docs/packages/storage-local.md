---
title: "@storyshelf/storage-local"
description: Store StoryShelf screenshots, diffs, and Storybook archives on a local filesystem.
---

`@storyshelf/storage-local` is the default blob storage adapter for a single-node deployment. It stores screenshots, diff overlays, and uploaded Storybook archives below one data directory.

## Install

```sh
nub add @storyshelf/storage-local
```

## Configure

```ts
import { createLocalStorage } from "@storyshelf/storage-local";

const storage = createLocalStorage("./data");
const app = createShelfRouter({ database, storage });
```

Directories are created as needed. Paths are resolved beneath the configured data directory; attempts to escape it are rejected. The adapter implements `StorageAdapter`: `read`, `write`, `delete`, `exists`, and `list(prefix)`.

## When to use it

Use local storage with [SQLite](../db-sqlite/) for a simple single-node deployment. For cloud or multi-node deployments where instances need shared objects, switch to [S3 storage](../storage-s3/) without changing the core router.
