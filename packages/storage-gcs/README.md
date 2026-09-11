# @storyshelf/storage-gcs

Google Cloud Storage (GCS) adapter for StoryShelf: reads and writes blobs to a GCS bucket, including GCS-compatible emulators.

## Install

```sh
nub add @storyshelf/storage-gcs
```

or

```sh
npm install @storyshelf/storage-gcs
```

## Quick start

```ts
import { createGcsStorage } from "@storyshelf/storage-gcs";
import { createShelfApp } from "@storyshelf/app";

const storage = createGcsStorage({
  bucket: "my-shelf",
  prefix: "storyshelf",           // optional
  projectId: "my-gcp-project",    // optional, defaults to ADC
});

const app = createShelfApp({ database, storage });
```

For local emulators or custom endpoints:

```ts
const storage = createGcsStorage({
  bucket: "my-shelf",
  apiEndpoint: "http://localhost:9090",
  projectId: "test-project",
});
```

Inject a pre-configured client (tests / IAM-rotation):

```ts
import { Storage } from "@google-cloud/storage";

const client = new Storage({ projectId: "my-project" });
const storage = createGcsStorage({ bucket: "my-shelf", client });
```

## API

### `GcsStorageOptions`

```ts
interface GcsStorageOptions {
  bucket: string;          // required GCS bucket name
  prefix?: string;         // optional key prefix, defaults to ""
  client?: Storage;        // optional pre-configured @google-cloud/storage client
  projectId?: string;      // optional GCP project id
  keyFilename?: string;    // optional path to service-account JSON
  credentials?: object;    // optional service-account credentials object
  apiEndpoint?: string;    // optional custom endpoint (emulator)
}
```

### `createGcsStorage(options: GcsStorageOptions): StorageAdapter`

Creates a `StorageAdapter` backed by the configured GCS bucket. The returned adapter implements every method of the `StorageAdapter` interface (`read`, `write`, `delete`, `exists`, `list(prefix)`, `readStream`, `writeStream`).

### `gcsKey(prefix: string, path: string): string`

Helper that joins a storage prefix with a relative path into an object key.

## How it fits in

`storage-gcs` is the `storage` option for `createShelfApp` in GCP deployments. It implements the same `StorageAdapter` interface as `@storyshelf/storage-local` and `@storyshelf/storage-s3`, so switching between local disk, S3, and GCS requires no changes elsewhere.

See `docs/architecture.md` and ADR 0006.
