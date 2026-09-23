/**
 * Azure Blob Storage adapter for StoryShelf.
 *
 * Persists captured screenshots and diff overlays in an Azure Blob container.
 * The CLI uploads the built Storybook; the server renders stories with
 * Playwright and stores the resulting blobs here.
 */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { resolveContainerClient, type AzureContext } from "./client.ts";
import { buildAzureLifecycle } from "./lifecycle.ts";
import { azureDelete, azureExists, azureList, azureRead, azureWrite } from "./operations.ts";
import { azureReadStream, azureWriteStream } from "./streams.ts";
import type { AzureStorageOptions } from "./types.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create an Azure Blob Storage-backed StorageAdapter.
 *
 * @param options - Azure configuration options.
 * @returns A StorageAdapter backed by the configured Azure container.
 */
export function createAzureStorage(options: AzureStorageOptions): StorageAdapter {
  const { container: containerName, prefix = "" } = options;
  const container = resolveContainerClient(options, containerName);
  const ctx: AzureContext = { container, prefix };

  return {
    metadata: {
      name: "Azure Blob Storage",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "Azure Blob Storage adapter",
      kind: "azure",
      category: "storage",
    },
    lifecycle: buildAzureLifecycle(container, containerName),
    async read(path) {
      return await azureRead(ctx, path);
    },
    async write(path, data) {
      await azureWrite(ctx, path, data);
    },
    async delete(path) {
      await azureDelete(ctx, path);
    },
    async exists(path) {
      return await azureExists(ctx, path);
    },
    async list(listPrefix) {
      return await azureList(ctx, listPrefix);
    },
    async writeStream(path, stream) {
      await azureWriteStream(ctx, path, stream);
    },
    async readStream(path) {
      return await azureReadStream(ctx, path);
    },
  };
}

export type { AzureStorageOptions } from "./types.ts";
export { azureKey } from "./keys.ts";
