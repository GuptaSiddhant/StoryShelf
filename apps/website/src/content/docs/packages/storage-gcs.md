---
title: "@storyshelf/storage-gcs"
description: Store StoryShelf artifacts in Google Cloud Storage.
---

`@storyshelf/storage-gcs` stores StoryShelf blobs in a **Google Cloud Storage (GCS)** bucket — captured screenshots, diff overlays, and uploaded Storybook archives.

## Install

```sh
nub add @storyshelf/storage-gcs
```

[![JSR](https://jsr.io/badges/@storyshelf/storage-gcs)](https://jsr.io/@storyshelf/storage-gcs) [![JSR Score](https://jsr.io/badges/@storyshelf/storage-gcs/score)](https://jsr.io/@storyshelf/storage-gcs)

- [npm package](https://www.npmjs.com/package/@storyshelf/storage-gcs) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/storage-gcs) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/storage-gcs/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/storage-gcs) — package directory on `main`.

## Configure

```ts
import { createGcsStorage } from "@storyshelf/storage-gcs";

const storage = createGcsStorage({
  bucket: "my-shelf",
  prefix: "storyshelf/",
  projectId: "my-gcp-project",
});
```

| Option | Required | Notes |
|---|---|---|
| `bucket` | yes | GCS bucket name |
| `prefix` | no | Key prefix for every object |
| `client` | no | Pre-built `Storage` client (tests, custom endpoint) |
| `projectId` | no | GCP project ID (defaults to ADC) |
| `keyFilename` | no | Path to service-account JSON |
| `credentials` | no | Inline service-account object |
| `apiEndpoint` | no | Custom endpoint (emulator, e.g. `http://localhost:9090`) |

Auth otherwise uses Application Default Credentials. The adapter implements `StorageAdapter`: `read`, `write`, `delete`, `exists`, `list(prefix)`, plus `readStream`/`writeStream`. `gcsKey(prefix, path)` is re-exported for manual key construction.

## When to use it

Use GCS for GCP deploys — Cloud Run, GKE, or Cloud Functions — especially paired with [queue-redis](../queue-redis/) or Pub/Sub-style polling and [db-postgres](../db-postgres/). It is a drop-in replacement for [local storage](../storage-local/), [S3](../storage-s3/), and [Azure Blob](../storage-azure/).
