/** Which object storage the Fly demo uses, chosen from its environment. */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { redactUrlForLog } from "@storyshelf/core/utils";
import { createLocalStorage } from "@storyshelf/storage-local";
import { createS3Storage, type S3StorageOptions } from "@storyshelf/storage-s3";

/** What the boot log says about the storage in use: never a bucket, a key or a credential. */
export type StorageLog = { storage: "local" } | { storage: "s3"; endpointOrigin: string | null };

/** The adapter constructors, replaceable so a test can see what they were given. */
export interface StorageFactories {
  s3(options: S3StorageOptions): StorageAdapter;
  local(dataDir: string): StorageAdapter;
}

/** An environment value, or undefined when it is unset or empty. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

const DEFAULT_FACTORIES: StorageFactories = { s3: createS3Storage, local: createLocalStorage };

/**
 * S3-compatible storage (Tigris on Fly) when `AWS_BUCKET` (or `BUCKET_NAME`, the name
 * `fly storage create` uses) is set, else the volume under `dataDir`. The endpoint is
 * `AWS_ENDPOINT_URL_S3` and the region `AWS_REGION` (Tigris answers to `auto`). Credentials are never read here: the SDK's default chain takes `AWS_ACCESS_KEY_ID` and
 * `AWS_SECRET_ACCESS_KEY` from the environment.
 */
export function storageFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  dataDir: string,
  factories: StorageFactories = DEFAULT_FACTORIES,
): { storage: StorageAdapter; log: StorageLog } {
  const bucket = nonEmpty(env["AWS_BUCKET"]) ?? nonEmpty(env["BUCKET_NAME"]);
  if (bucket === undefined) {
    return { storage: factories.local(dataDir), log: { storage: "local" } };
  }
  const endpoint = nonEmpty(env["AWS_ENDPOINT_URL_S3"]);
  return {
    storage: factories.s3({ bucket, endpoint, region: nonEmpty(env["AWS_REGION"]) ?? "auto" }),
    log: { storage: "s3", endpointOrigin: endpoint ? redactUrlForLog(endpoint) : null },
  };
}
