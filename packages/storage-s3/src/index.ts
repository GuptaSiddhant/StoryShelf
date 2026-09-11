import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";

declare const __PKG_VERSION__: string | undefined;

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
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "S3-compatible storage adapter",
      kind: "s3",
      category: "storage",
    },
    lifecycle: buildLifecycle(client, injectedClient === undefined, bucket, prefix),
    async read(path) {
      return await s3Read(ctx, path);
    },
    async write(path, data) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: s3Key(prefix, path), Body: data }),
      );
    },
    async delete(path) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3Key(prefix, path) }));
    },
    async exists(path) {
      return await s3Exists(ctx, path);
    },
    async list(listPrefix) {
      return await s3List(ctx, listPrefix);
    },
    async writeStream(path, stream) {
      await s3WriteStream(ctx, path, stream);
    },
    async readStream(path) {
      return await s3ReadStream(ctx, path);
    },
  };
}

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

/** Join an optional key prefix with a storage path. */
export function s3Key(prefix: string, path: string): string {
  return prefix === "" ? path : `${prefix}/${path}`;
}

interface S3Context {
  client: S3Client;
  bucket: string;
  prefix: string;
}

/** All-or-nothing lifecycle: probe bucket access, destroy owned clients. */
function buildLifecycle(
  client: S3Client,
  ownsClient: boolean,
  bucket: string,
  prefix: string,
): StorageAdapter["lifecycle"] {
  let destroyed = false;
  return {
    setup: async () => {
      await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }));
    },
    teardown: () => {
      if (!ownsClient || destroyed) {
        return Promise.resolve();
      }
      destroyed = true;
      client.destroy();
      return Promise.resolve();
    },
    health: async () => {
      await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }));
      return { ok: true };
    },
  };
}

function s3Rel(prefix: string, key: string): string {
  return prefix === "" ? key : key.slice(prefix.length + 1);
}

function isNotFound(error: unknown): boolean {
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404;
}

function isWebStream(body: unknown): body is NodeWebStream {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { getReader?: unknown }).getReader === "function"
  );
}

async function s3WriteStream(ctx: S3Context, path: string, stream: Readable): Promise<void> {
  const upload = new Upload({
    client: ctx.client,
    params: { Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path), Body: stream },
  });
  await upload.done();
}

async function s3ReadStream(ctx: S3Context, path: string): Promise<Readable> {
  const response = await ctx.client.send(
    new GetObjectCommand({ Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path) }),
  );
  const body: unknown = response.Body;
  if (body instanceof Readable) {
    return body;
  }
  if (isWebStream(body)) {
    return Readable.fromWeb(body);
  }
  throw new Error(`No object at "${path}"`);
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
    await ctx.client.send(
      new HeadObjectCommand({ Bucket: ctx.bucket, Key: s3Key(ctx.prefix, path) }),
    );
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
