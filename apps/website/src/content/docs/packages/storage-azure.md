---
title: "@storyshelf/storage-azure"
description: Store StoryShelf artifacts in Azure Blob Storage.
---

`@storyshelf/storage-azure` stores StoryShelf blobs in an **Azure Blob Storage** container. It persists the same artifacts as the other storage adapters — captured screenshots, diff overlays, and uploaded Storybook archives.

## Install

```sh
nub add @storyshelf/storage-azure
```

[![JSR](https://jsr.io/badges/@storyshelf/storage-azure)](https://jsr.io/@storyshelf/storage-azure) [![JSR Score](https://jsr.io/badges/@storyshelf/storage-azure/score)](https://jsr.io/@storyshelf/storage-azure)

- [npm package](https://www.npmjs.com/package/@storyshelf/storage-azure) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/storage-azure) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/storage-azure/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/storage-azure) — package directory on `main`.

## Configure

```ts
import { createAzureStorage } from "@storyshelf/storage-azure";

const storage = createAzureStorage({
  container: "my-shelf",
  prefix: "storyshelf/",
  connectionString: process.env.AZURE_STORAGE_CONNECTION,
});

// or with explicit account credentials
const storage = createAzureStorage({
  container: "my-shelf",
  accountName: "myaccount",
  accountKey: process.env.AZURE_ACCOUNT_KEY!,
  accountUrl: "https://myaccount.blob.core.windows.net",
  sasToken: process.env.AZURE_SAS_TOKEN, // with or without leading ?
});

// or bring your own client (tests, custom retry, Azurite emulator)
import { BlobServiceClient } from "@azure/storage-blob";
const storage = createAzureStorage({
  container: "my-shelf",
  client: BlobServiceClient.fromConnectionString(connStr).getContainerClient("my-shelf"),
});
```

| Option | Required | Notes |
|---|---|---|
| `container` | yes | Blob container name |
| `prefix` | no | Key prefix applied to every object |
| `client` | no | Pre-built `ContainerClient`; skips client construction |
| `connectionString` | no* | Storage connection string |
| `accountName` / `accountKey` | no* | Explicit credentials pair |
| `accountUrl` / `sasToken` | no* | URL + SAS form (emulator, fine-grained SAS) |

`*` At least one auth form is needed unless `client` is supplied.

The adapter implements `StorageAdapter`: `read`, `write`, `delete`, `exists`, `list(prefix)`, plus `readStream`/`writeStream`. `azureKey(prefix, path)` is re-exported when code needs to construct an object key.

## When to use it

Choose Azure Blob Storage for Azure deploys — Container Apps, AKS, or Functions — especially paired with [queue-azure](../queue-azure/) and [db-postgres](../db-postgres/). It is a drop-in replacement for [local storage](../storage-local/) and [S3 storage](../storage-s3/); for Google Cloud see [storage-gcs](../storage-gcs/).
