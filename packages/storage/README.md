# @storyshelf/storage

Storage adapters for StoryShelf, one subpath per backend: S3-compatible stores (`/s3`), Google Cloud Storage (`/gcs`), Azure Blob Storage (`/azure`) and local disk (`/local`).

## Install

Install the package and **only the SDK of the backend you use**. The cloud SDKs are optional peer dependencies, and a subpath loads only its own, so a server that uses `/s3` never has the Google or Azure SDK in `node_modules`.

| Subpath               | Install next to `@storyshelf/storage`                  |
| --------------------- | ------------------------------------------------------ |
| `@storyshelf/storage/s3`    | `@aws-sdk/client-s3` and `@aws-sdk/lib-storage`  |
| `@storyshelf/storage/gcs`   | `@google-cloud/storage`                          |
| `@storyshelf/storage/azure` | `@azure/storage-blob` and `@azure/identity`      |
| `@storyshelf/storage/local` | nothing                                          |

```sh
nub add @storyshelf/storage @aws-sdk/client-s3 @aws-sdk/lib-storage
```

or

```sh
npm install @storyshelf/storage @aws-sdk/client-s3 @aws-sdk/lib-storage
```

`create-storyshelf` adds the right SDK for the storage you choose. The SDKs supply credentials (environment, IRSA and workload identity, the metadata servers, managed identity), request signing, retries and multipart uploads, which is why StoryShelf uses them instead of calling the REST APIs itself.

## Quick start

Every backend is one import. Switching from local disk to S3 changes the import path and nothing else:

```ts
import { createShelfApp } from "@storyshelf/app";
import { createLocalStorage } from "@storyshelf/storage/local"; // same as @storyshelf/core/storage/local
import { createS3Storage } from "@storyshelf/storage/s3";
import { createGcsStorage } from "@storyshelf/storage/gcs";
import { createAzureStorage } from "@storyshelf/storage/azure";

const app = createShelfApp({ database, storage: createS3Storage({ bucket: "my-shelf" }) });
```

`/local` re-exports core's built-in local storage and adds no dependency. The implementation stays in `@storyshelf/core/storage/local`, so a server that never installs this package still has local storage.

## S3-compatible stores (`/s3`)

AWS S3, Cloudflare R2, MinIO, Backblaze B2, Wasabi, DigitalOcean Spaces and Tigris all use `/s3`; point `endpoint` at the service.

### Usage

```ts
import { createS3Storage } from "@storyshelf/storage/s3";
import { createShelfApp } from "@storyshelf/app";

const storage = createS3Storage({
  bucket: "my-shelf",
  prefix: "storyshelf",
  endpoint: process.env.S3_ENDPOINT, // optional, e.g. for MinIO/R2
  region: "us-east-1", // optional
});

const app = createShelfApp({ database, storage });
```

### API

#### `S3StorageOptions`

```ts
interface S3StorageOptions {
  bucket: string; // required bucket name
  prefix?: string; // optional key prefix, defaults to ""
  endpoint?: string; // optional custom endpoint (MinIO, R2, etc.)
  region?: string; // optional region, defaults to "us-east-1"
}
```

#### `createS3Storage(options: S3StorageOptions): StorageAdapter`

Creates an S3 client (with `forcePathStyle` enabled for compatibility with MinIO/R2) and returns a `StorageAdapter`. The returned adapter implements every method of the `StorageAdapter` interface (`read`, `write`, `delete`, `exists`, `list(prefix)`).

#### `s3Key(prefix: string, path: string): string`

Helper that joins a storage prefix with a relative path into an object key.

## Google Cloud Storage (`/gcs`)

### Usage

```ts
import { createGcsStorage } from "@storyshelf/storage/gcs";
import { createShelfApp } from "@storyshelf/app";

const storage = createGcsStorage({
  bucket: "my-shelf",
  prefix: "storyshelf", // optional
  projectId: "my-gcp-project", // optional, defaults to ADC
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

### API

#### `GcsStorageOptions`

```ts
interface GcsStorageOptions {
  bucket: string; // required GCS bucket name
  prefix?: string; // optional key prefix, defaults to ""
  client?: Storage; // optional pre-configured @google-cloud/storage client
  projectId?: string; // optional GCP project id
  keyFilename?: string; // optional path to service-account JSON
  credentials?: object; // optional service-account credentials object
  apiEndpoint?: string; // optional custom endpoint (emulator)
}
```

Options at a glance:

| Option        | Required | Notes                                                    |
| ------------- | -------- | -------------------------------------------------------- |
| `bucket`      | yes      | GCS bucket name                                          |
| `prefix`      | no       | Key prefix for every object                              |
| `client`      | no       | Pre-built `Storage` client (tests, custom endpoint)      |
| `projectId`   | no       | GCP project ID (defaults to ADC)                         |
| `keyFilename` | no       | Path to service-account JSON                             |
| `credentials` | no       | Inline service-account object                            |
| `apiEndpoint` | no       | Custom endpoint (emulator, e.g. `http://localhost:9090`) |

Auth otherwise uses Application Default Credentials.

#### `createGcsStorage(options: GcsStorageOptions): StorageAdapter`

Creates a `StorageAdapter` backed by the configured GCS bucket. The returned adapter implements every method of the `StorageAdapter` interface (`read`, `write`, `delete`, `exists`, `list(prefix)`, `readStream`, `writeStream`).

#### `gcsKey(prefix: string, path: string): string`

Helper that joins a storage prefix with a relative path into an object key.

## Azure Blob Storage (`/azure`)

### Usage

```ts
import { createAzureStorage } from "@storyshelf/storage/azure";
import { createShelfApp } from "@storyshelf/app";

// Via connection string (recommended for local / Azurite)
const storage = createAzureStorage({
  container: "storyshelf",
  prefix: "storyshelf", // optional
  connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
});

// Via account name + key
const storage2 = createAzureStorage({
  container: "storyshelf",
  accountName: "myaccount",
  accountKey: process.env.AZURE_STORAGE_KEY,
  accountUrl: "https://myaccount.blob.core.windows.net", // optional, derived from accountName if omitted
});

const app = createShelfApp({ database, storage });
```

Inject a pre-configured client (tests / custom credential rotation):

```ts
import { BlobServiceClient } from "@azure/storage-blob";

const service = BlobServiceClient.fromConnectionString(connStr);
const containerClient = service.getContainerClient("storyshelf");
const storage = createAzureStorage({ container: "storyshelf", client: containerClient });
```

Azurite (local emulator):

```ts
const storage = createAzureStorage({
  container: "storyshelf",
  connectionString:
    "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;",
});
```

### API

#### `AzureStorageOptions`

```ts
interface AzureStorageOptions {
  container: string; // required container name
  prefix?: string; // optional blob prefix, defaults to ""
  client?: ContainerClient; // optional pre-configured container client
  connectionString?: string; // optional Azure connection string
  accountName?: string; // optional storage account name
  accountKey?: string; // optional storage account key
  accountUrl?: string; // optional blob service URL (e.g. https://myaccount.blob.core.windows.net)
  sasToken?: string; // optional SAS token (without leading ? OK)
  credential?: TokenCredential; // optional Entra credential; default DefaultAzureCredential
  managedIdentityClientId?: string; // client id of a user-assigned managed identity
}
```

Options at a glance:

| Option                       | Required | Notes                                                  |
| ---------------------------- | -------- | ------------------------------------------------------ |
| `container`                  | yes      | Blob container name                                    |
| `prefix`                     | no       | Key prefix applied to every object                     |
| `client`                     | no       | Pre-built `ContainerClient`; skips client construction |
| `connectionString`           | no\*     | Storage connection string                              |
| `accountName` / `accountKey` | no\*     | Explicit credentials pair                              |
| `accountUrl` / `sasToken`    | no\*     | URL + SAS form (emulator, fine-grained SAS)            |
| `accountName` alone          | no\*     | Entra: `DefaultAzureCredential` (managed identity)     |
| `managedIdentityClientId`    | no       | Picks a user-assigned identity for the default         |
| `credential`                 | no       | Your own `TokenCredential`, instead of the default     |

`*` One auth form is needed unless `client` is supplied. With only an account name or URL (no key,
SAS token or connection string) the adapter signs in with `DefaultAzureCredential`: a managed
identity on Azure, `az login` locally. The identity needs `Storage Blob Data Contributor` on the
container. An anonymous (public) container is no longer the fallback; give a `client` for that.

#### `createAzureStorage(options: AzureStorageOptions): StorageAdapter`

Creates a `StorageAdapter` backed by the configured Azure container. The returned adapter implements every method of the `StorageAdapter` interface (`read`, `write`, `delete`, `exists`, `list(prefix)`, `readStream`, `writeStream`).

#### `azureKey(prefix: string, path: string): string`

Helper that joins a storage prefix with a relative path into a blob name.

## How it fits in

Each factory returns a `StorageAdapter`, the `storage` option of `createShelfApp`, so backends are interchangeable. `StorageAdapter` is an open extension point: write your own against `@storyshelf/core/adapter/storage`.

See `docs/architecture/storage.md` and ADR 0003.
