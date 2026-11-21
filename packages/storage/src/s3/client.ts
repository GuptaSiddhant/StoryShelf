/** S3 client construction/injection and shared request context. */
import { S3Client } from "@aws-sdk/client-s3";
import type { S3StorageOptions } from "./types.ts";

/** Resolve the effective client, bucket, and prefix for one storage instance. */
export function resolveS3Context(options: S3StorageOptions): {
  ctx: S3Context;
  ownsClient: boolean;
} {
  const { bucket, prefix = "", endpoint, region = "us-east-1", client: injectedClient } = options;
  const client = injectedClient ?? new S3Client({ endpoint, region, forcePathStyle: true });
  return { ctx: { client, bucket, prefix }, ownsClient: injectedClient === undefined };
}

/** Shared S3 request context threaded through operations, streams, and lifecycle. */
export interface S3Context {
  client: S3Client;
  bucket: string;
  prefix: string;
}
