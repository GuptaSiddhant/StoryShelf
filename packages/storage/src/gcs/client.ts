/** GCS Storage client construction and shared operation context. */
import { Storage } from "@google-cloud/storage";
import type { GcsStorageOptions } from "./types.ts";

/** Build the bucket handle plus key prefix every GCS operation threads through. */
export function createGcsContext(options: GcsStorageOptions): GcsContext {
  const { bucket: bucketName, prefix = "", client: injectedClient } = options;
  const client = injectedClient ?? new Storage(resolveClientOptions(options));
  return { bucket: client.bucket(bucketName), prefix };
}

/** Shared GCS bucket handle plus key prefix. */
export interface GcsContext {
  bucket: ReturnType<Storage["bucket"]>;
  prefix: string;
}

/** Translate adapter options into @google-cloud/storage constructor options. */
export function resolveClientOptions(
  options: GcsStorageOptions,
): ConstructorParameters<typeof Storage>[0] {
  const config: ConstructorParameters<typeof Storage>[0] = {};
  if (options.projectId !== undefined) {
    config.projectId = options.projectId;
  }
  if (options.keyFilename !== undefined) {
    config.keyFilename = options.keyFilename;
  }
  if (options.credentials !== undefined) {
    config.credentials = options.credentials;
  }
  if (options.apiEndpoint !== undefined) {
    config.apiEndpoint = options.apiEndpoint;
  }
  return config;
}
