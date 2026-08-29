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

/**
 * Create an S3-compatible StorageAdapter (AWS S3, R2, MinIO, etc.).
 *
 * @param options - S3 configuration options.
 * @returns A StorageAdapter backed by the configured S3 bucket.
 */
export function createS3Storage(options: S3StorageOptions): StorageAdapter {
  const { bucket, prefix = "", endpoint, region = "us-east-1", client: injectedClient } = options;
  const client = injectedClient ?? new S3Client({ endpoint, region, forcePathStyle: true });

  return {
    async read(path) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: s3Key(prefix, path) }),
      );
      const body = response.Body;
      if (body === undefined) {
        return Buffer.alloc(0);
      }
      return Buffer.from(await body.transformToByteArray());
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
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key(prefix, path) }));
        return true;
      } catch (error) {
        if (isNotFound(error)) {
          return false;
        }
        throw error;
      }
    },
    async list(listPrefix) {
      const response = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: s3Key(prefix, listPrefix) }),
      );
      return (response.Contents ?? [])
        .map((item) => item.Key)
        .filter((key): key is string => key !== undefined)
        .map((key) => s3Rel(prefix, key));
    },
  };
}
