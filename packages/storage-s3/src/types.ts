import type { S3Client } from "@aws-sdk/client-s3";

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
