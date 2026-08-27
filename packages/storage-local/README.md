# @storyshelf/storage-local

The default storage adapter for self-hosted StoryShelf: reads and writes blobs to the local filesystem under a data directory. One `docker run` to self-host.

## Install

```sh
nub add @storyshelf/storage-local
```

or

```sh
npm install @storyshelf/storage-local
```

## Quick start

```ts
import { createLocalStorage } from "@storyshelf/storage-local";
import { createShelfRouter } from "@storyshelf/core";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";

const storage = createLocalStorage("./data");
const database = createSqliteDatabase("./data/shelf.db");

const app = createShelfRouter({ database, storage });
```

## API

### `createLocalStorage(dataDir: string): StorageAdapter`

Stores all blobs under the resolved `dataDir` (creating directories as needed). Paths are confined to the data directory — any path escaping it throws an error.

The returned adapter implements every method of the `StorageAdapter` interface (`read`, `write`, `delete`, `exists`, `list(prefix)`).

## How it fits in

`storage-local` is the default `storage` option for `createShelfRouter` in single-node deployments, storing screenshots, diff overlays, and storybook archives on disk. It implements the same `StorageAdapter` interface as `@storyshelf/storage-s3`, so moving to object storage later is a drop-in swap.

See `docs/architecture.md` and ADR 0006.
