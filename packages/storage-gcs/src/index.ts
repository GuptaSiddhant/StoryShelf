/**
 * Google Cloud Storage adapter for StoryShelf.
 *
 * Server-side blob storage for screenshots, diffs, and Storybook archives.
 * The factory wires per-concern modules (client, lifecycle, operations,
 * streams); key and option helpers are re-exported below.
 */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { createGcsContext } from "./client.ts";
import { createGcsLifecycle } from "./lifecycle.ts";
import { gcsDelete, gcsExists, gcsList, gcsRead, gcsWrite } from "./operations.ts";
import { gcsReadStream, gcsWriteStream } from "./streams.ts";
import type { GcsStorageOptions } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create a Google Cloud Storage (GCS) StorageAdapter.
 *
 * @param options - GCS configuration options.
 * @returns A StorageAdapter backed by the configured GCS bucket.
 */
export function createGcsStorage(options: GcsStorageOptions): StorageAdapter {
  const ctx = createGcsContext(options);

  return {
    metadata: {
      name: "GCS Storage",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Google Cloud Storage adapter",
      kind: "gcs",
      category: "storage",
    },
    lifecycle: createGcsLifecycle(ctx),
    async read(path) {
      return await gcsRead(ctx, path);
    },
    async write(path, data) {
      await gcsWrite(ctx, path, data);
    },
    async delete(path) {
      await gcsDelete(ctx, path);
    },
    async exists(path) {
      return await gcsExists(ctx, path);
    },
    async list(listPrefix) {
      return await gcsList(ctx, listPrefix);
    },
    async writeStream(path, stream) {
      await gcsWriteStream(ctx, path, stream);
    },
    async readStream(path) {
      return await gcsReadStream(ctx, path);
    },
  };
}

export type { GcsStorageOptions } from "./types.ts";
export { gcsKey } from "./keys.ts";
