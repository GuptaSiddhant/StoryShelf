# @storyshelf/storage-azure

Azure Blob Storage adapter for StoryShelf: reads and writes blobs to an Azure Storage container, including Azurite emulator support.

## Install

```sh
nub add @storyshelf/storage-azure
```

or

```sh
npm install @storyshelf/storage-azure
```

## Quick start

```ts
import { createAzureStorage } from "@storyshelf/storage-azure";
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
  connectionString: "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;",
});
```

## API

### `AzureStorageOptions`

```ts
interface AzureStorageOptions {
  container: string;          // required container name
  prefix?: string;            // optional blob prefix, defaults to ""
  client?: ContainerClient;   // optional pre-configured container client
  connectionString?: string;  // optional Azure connection string
  accountName?: string;       // optional storage account name
  accountKey?: string;        // optional storage account key
  accountUrl?: string;        // optional blob service URL (e.g. https://myaccount.blob.core.windows.net)
  sasToken?: string;          // optional SAS token (without leading ? OK)
}
```

### `createAzureStorage(options: AzureStorageOptions): StorageAdapter`

Creates a `StorageAdapter` backed by the configured Azure container. The returned adapter implements every method of the `StorageAdapter` interface (`read`, `write`, `delete`, `exists`, `list(prefix)`, `readStream`, `writeStream`).

### `azureKey(prefix: string, path: string): string`

Helper that joins a storage prefix with a relative path into a blob name.

## How it fits in

`storage-azure` is the `storage` option for `createShelfApp` in Azure deployments. It implements the same `StorageAdapter` interface as `@storyshelf/storage-local`, `@storyshelf/storage-s3`, and `@storyshelf/storage-gcs`, so switching between local disk, S3, GCS, and Azure requires no changes elsewhere.

See `docs/architecture.md` and ADR 0006.
