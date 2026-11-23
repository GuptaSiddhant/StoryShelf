import type { AzureContext } from "./client.ts";
import { collectDownload, isNotFound } from "./errors.ts";
import { azureKey, azureRel } from "./keys.ts";

/** Buffered Azure blob CRUD with SDK-version duck-typing and async-iterator list. */

/** Download a blob, preferring `downloadToBuffer` when the SDK offers it. */
export async function azureRead(ctx: AzureContext, path: string): Promise<Buffer> {
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  if (
    typeof (blob as unknown as { downloadToBuffer?: () => Promise<Buffer> }).downloadToBuffer ===
    "function"
  ) {
    return await (
      blob as unknown as { downloadToBuffer: () => Promise<Buffer> }
    ).downloadToBuffer();
  }
  return await collectDownload(blob);
}

/** Upload a buffer, accepting either `uploadData` or `upload` SDK shapes. */
export async function azureWrite(ctx: AzureContext, path: string, data: Buffer): Promise<void> {
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  const withData = blob as unknown as {
    uploadData?: (buffer: Buffer) => Promise<void>;
    upload?: (buffer: Buffer, length: number) => Promise<void>;
  };
  if (typeof withData.uploadData === "function") {
    await withData.uploadData(data);
    return;
  }
  if (typeof withData.upload === "function") {
    await withData.upload(data, data.length);
    return;
  }
  throw new Error("Azure Blob client does not support upload");
}

/** Delete a blob, treating missing blobs as success. */
export async function azureDelete(ctx: AzureContext, path: string): Promise<void> {
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  const withDelete = blob as unknown as {
    deleteIfExists?: () => Promise<void>;
    delete?: () => Promise<void>;
  };
  if (typeof withDelete.deleteIfExists === "function") {
    await withDelete.deleteIfExists();
    return;
  }
  try {
    await withDelete.delete?.();
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
}

/** Check whether a blob exists. */
export async function azureExists(ctx: AzureContext, path: string): Promise<boolean> {
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  return await blob.exists();
}

/** List blob names under a prefix, with the storage prefix stripped. */
export async function azureList(ctx: AzureContext, listPrefix: string): Promise<string[]> {
  const prefix = azureKey(ctx.prefix, listPrefix);
  const blobs: string[] = [];
  for await (const item of ctx.container.listBlobsFlat(prefix === "" ? undefined : { prefix })) {
    blobs.push(azureRel(ctx.prefix, item.name));
  }
  return blobs;
}
