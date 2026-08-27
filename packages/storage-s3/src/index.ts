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

export interface S3StorageOptions {
  bucket: string;
  prefix?: string;
  endpoint?: string;
  region?: string;
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

export function createS3Storage(options: S3StorageOptions): StorageAdapter {
  const { bucket, prefix = "", endpoint, region = "us-east-1" } = options;
  const client = new S3Client({ endpoint, region, forcePathStyle: true });

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
