---
title: "@storyshelf/storage-s3"
description: Store StoryShelf artifacts in AWS S3, Cloudflare R2, MinIO, or another S3-compatible service.
---

`@storyshelf/storage-s3` stores StoryShelf blobs in an S3-compatible object store. It supports AWS S3, Cloudflare R2, MinIO, and DigitalOcean Spaces.

## Install

```sh
nub add @storyshelf/storage-s3
```

[![JSR](https://jsr.io/badges/@storyshelf/storage-s3)](https://jsr.io/@storyshelf/storage-s3) [![JSR Score](https://jsr.io/badges/@storyshelf/storage-s3/score)](https://jsr.io/@storyshelf/storage-s3)

- [npm package](https://www.npmjs.com/package/@storyshelf/storage-s3) — install tarballs and version history.
- [JSR package](https://jsr.io/@storyshelf/storage-s3) — TypeScript-first registry page.
- [Public API reference](https://jsr.io/@storyshelf/storage-s3/doc) — generated docs for every export; start here to learn the API.
- [Source on GitHub](https://github.com/GuptaSiddhant/storyshelf/tree/main/packages/storage-s3) — package directory on `main`.

## Configure

```ts
import { createS3Storage } from "@storyshelf/storage-s3";

const storage = createS3Storage({
  bucket: "my-shelf",
  prefix: "storyshelf",
  endpoint: process.env.S3_ENDPOINT,
  region: "us-east-1",
});
```

`bucket` is required. `prefix`, `endpoint`, and `region` are optional; the default region is `us-east-1`. The client uses path-style requests for compatibility with non-AWS providers. `s3Key(prefix, path)` is available when code needs to construct an object key.

The adapter implements `StorageAdapter`: `read`, `write`, `delete`, `exists`, and `list(prefix)`.

## When to use it

Choose S3 storage for cloud or multi-node deployments. It is a drop-in replacement for [local storage](../storage-local/), and pairs naturally with [Turso](../db-turso/) when the application is deployed without shared local disk.
