/**
 * S3-compatible storage adapter (AWS S3, R2, MinIO, etc.).
 *
 * Composition root: wires client resolution, lifecycle, buffered
 * operations, and streaming into a `StorageAdapter`. Key joining,
 * error guards, and per-concern logic live in their own modules.
 */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { resolveS3Context } from "./client.ts";
import { buildS3Lifecycle } from "./lifecycle.ts";
import { s3Delete, s3Exists, s3List, s3Read, s3Write } from "./operations.ts";
import { s3ReadStream, s3WriteStream } from "./streams.ts";
import type { S3StorageOptions } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create an S3-compatible StorageAdapter (AWS S3, R2, MinIO, etc.).
 *
 * @param options - S3 configuration options.
 * @returns A StorageAdapter backed by the configured S3 bucket.
 */
export function createS3Storage(options: S3StorageOptions): StorageAdapter {
  const { ctx, ownsClient } = resolveS3Context(options);
  const { client, bucket, prefix } = ctx;

  return {
    metadata: {
      name: "S3 Storage",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "S3-compatible storage adapter",
      kind: "s3",
      category: "storage",
    },
    lifecycle: buildS3Lifecycle(client, ownsClient, bucket, prefix),
    async read(path) {
      return await s3Read(ctx, path);
    },
    async write(path, data) {
      await s3Write(ctx, path, data);
    },
    async delete(path) {
      await s3Delete(ctx, path);
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

export type { S3StorageOptions } from "./types.ts";
export { s3Key } from "./keys.ts";
