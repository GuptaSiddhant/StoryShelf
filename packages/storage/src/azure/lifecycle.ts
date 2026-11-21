import type { ContainerClient } from "@azure/storage-blob";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";

/** Build the setup/health/teardown lifecycle for an Azure container. */
export function buildAzureLifecycle(
  container: ContainerClient,
  containerName: string,
): StorageAdapter["lifecycle"] {
  return {
    setup: async () => {
      await containerExists(container, containerName);
    },
    teardown: async () => {
      // ContainerClient holds no closable handle — sockets are process-global.
      await Promise.resolve();
    },
    health: async () => {
      await containerExists(container, containerName);
      return { ok: true };
    },
  };
}

async function containerExists(container: ContainerClient, containerName: string): Promise<void> {
  const exists = (container as unknown as { exists?: () => Promise<boolean> }).exists;
  if (typeof exists === "function") {
    const ok = await exists.call(container);
    if (!ok) {
      throw new Error(`Container not found: ${containerName}`);
    }
    return;
  }
  const iterator = container.listBlobsFlat({ prefix: "" })[Symbol.asyncIterator]();
  try {
    await iterator.next();
  } finally {
    await (iterator as { return?: () => Promise<unknown> }).return?.();
  }
}
