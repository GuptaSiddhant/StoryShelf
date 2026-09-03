import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import type { StorageAdapter } from "@storyshelf/core/adapter/storage";

declare const __PKG_VERSION__: string | undefined;

/** Options for configuring an S3-compatible storage adapter. */
export interface S3StorageOptions {
  /** S3 bucket name. */
  bucket: string;
  /** Optional key prefix applied to all stored objects. */
  prefix?: string;
  /** Custom endpoint for S3-compatible services (e.g. MinIO, R2). */
  endpoint?: string;
  /** AWS region. Defaults to `us-east-1`. */
  region?: string;
  /** Pre-configured S3 client. Defaults to a client built from the other options. */
  client?: S3Client;
}

export function s3Key(prefix: string, path: string): string {
  return prefix === "" ? path : `${prefix}/${path}`;
}

function s3Rel(prefix: string, key: string): string {
  return prefix === "" ? key : key.slice(prefix.length + 1);
}

function isNotFound(error: unknown): boolean {
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404;
}

interface S3Context {
  client: S3Client;
  bucket: string;
  prefix: string;
}

async function s3Read(ctx: S3Context, path: string): Promise<Buffer> {
  const response = await ctx.client.send(
    new GetObjectCommand({ Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path) }),
  );
  const body = response.Body;
  if (body === undefined) {
    return Buffer.alloc(0);
  }
  return Buffer.from(await body.transformToByteArray());
}

async function s3Exists(ctx: S3Context, path: string): Promise<boolean> {
  try {
    await ctx.client.send(new HeadObjectCommand({ Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path) }));
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function s3List(ctx: S3Context, listPrefix: string): Promise<string[]> {
  const response = await ctx.client.send(
    new ListObjectsV2Command({ Bucket: ctx.bucket, Prefix: s3Key(ctx.prefix, listPrefix) }),
  );
  return (response.Contents ?? [])
    .map((item) => item.Key)
    .filter((key): key is string => key !== undefined)
    .map((key) => s3Rel(ctx.prefix, key));
}

/**
 * Create an S3-compatible StorageAdapter (AWS S3, R2, MinIO, etc.).
 *
 * @param options - S3 configuration options.
 * @returns A StorageAdapter backed by the configured S3 bucket.
 */
export function createS3Storage(options: S3StorageOptions): StorageAdapter {
  const { bucket, prefix = "", endpoint, region = "us-east-1", client: injectedClient } = options;
  const client = injectedClient ?? new S3Client({ endpoint, region, forcePathStyle: true });
  const ctx: S3Context = { client, bucket, prefix };

  return {
    metadata: {
      name: "S3 Storage",
      version: __PKG_VERSION__ ?? "0.0.0",
      description: "S3-compatible storage adapter",
      kind: "s3",
    },
    async read(path) {
      return await s3Read(ctx, path);
    },
    async write(path, data) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: s3Key(prefix, path), Body: data }),
      );
    },
    async delete(path) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: s3Key(prefix, path) }),
      );
    },
    async exists(path) {
      return await s3Exists(ctx, path);
    },
    async list(listPrefix) {
      return await s3List(ctx, listPrefix);
    },
  };
}
