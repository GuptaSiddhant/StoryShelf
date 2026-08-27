---
title: "@storyshelf/storage-s3"
description: Store StoryShelf artifacts in AWS S3, Cloudflare R2, MinIO, or another S3-compatible service.
---

`@storyshelf/storage-s3` stores StoryShelf blobs in an S3-compatible object store. It supports AWS S3, Cloudflare R2, MinIO, and DigitalOcean Spaces.

## Install

```sh
nub add @storyshelf/storage-s3
```

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
