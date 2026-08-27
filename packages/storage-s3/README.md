# @storyshelf/storage-s3

The S3-compatible storage adapter for StoryShelf: reads and writes blobs to any S3-compatible object store, including AWS S3, Cloudflare R2, MinIO, and DigitalOcean Spaces.

## Install

```sh
nub add @storyshelf/storage-s3
```

or

```sh
npm install @storyshelf/storage-s3
```

## Quick start

```ts
import { createS3Storage } from "@storyshelf/storage-s3";
import { createShelfRouter } from "@storyshelf/core";

const storage = createS3Storage({
  bucket: "my-shelf",
  prefix: "storyshelf",
  endpoint: process.env.S3_ENDPOINT, // optional, e.g. for MinIO/R2
  region: "us-east-1",               // optional
});

const app = createShelfRouter({ database, storage });
```

## API

### `S3StorageOptions`

```ts
interface S3StorageOptions {
  bucket: string;      // required bucket name
  prefix?: string;     // optional key prefix, defaults to ""
  endpoint?: string;   // optional custom endpoint (MinIO, R2, etc.)
  region?: string;     // optional region, defaults to "us-east-1"
}
```

### `createS3Storage(options: S3StorageOptions): StorageAdapter`

Creates an S3 client (with `forcePathStyle` enabled for compatibility with MinIO/R2) and returns a `StorageAdapter`. The returned adapter implements every method of the `StorageAdapter` interface (`read`, `write`, `delete`, `exists`, `list(prefix)`).

### `s3Key(prefix: string, path: string): string`

Helper that joins a storage prefix with a relative path into an object key.

## How it fits in

`storage-s3` is the `storage` option for `createShelfRouter` in cloud or multi-node deployments. It implements the same `StorageAdapter` interface as `@storyshelf/storage-local`, so switching between local disk and object storage requires no changes elsewhere.

See `docs/architecture.md` and ADR 0006.
