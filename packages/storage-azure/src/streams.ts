import type { ContainerClient } from "@azure/storage-blob";
import { Readable } from "node:stream";
import type { AzureContext } from "./client.ts";
import { collectStream, deleteBlobQuiet } from "./errors.ts";
import { azureKey } from "./keys.ts";
import { azureExists, azureWrite } from "./operations.ts";

/** Streamed Azure blob reads and writes, with failure cleanup. */

/** Upload a readable, streaming when the SDK supports it and buffering otherwise. */
export async function azureWriteStream(
  ctx: AzureContext,
  path: string,
  stream: Readable,
): Promise<void> {
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  if (await tryAzureStreamUpload(blob, stream)) {
    return;
  }
  await writeStreamBuffered(ctx, path, stream, blob);
}

/** Download a blob as a readable, rejecting when the blob is missing. */
export async function azureReadStream(ctx: AzureContext, path: string): Promise<Readable> {
  const exists = await azureExists(ctx, path);
  if (!exists) {
    throw new Error(`No object at "${path}"`);
  }
  const blob = ctx.container.getBlockBlobClient(azureKey(ctx.prefix, path));
  const response = await blob.download();
  const body = response.readableStreamBody as unknown as Readable | undefined;
  if (!body) {
    return Readable.from([]);
  }
  return body;
}

async function tryAzureStreamUpload(
  blob: ReturnType<ContainerClient["getBlockBlobClient"]>,
  stream: Readable,
): Promise<boolean> {
  const withStream = blob as unknown as { uploadStream?: (s: Readable) => Promise<void> };
  if (typeof withStream.uploadStream !== "function") {
    return false;
  }
  try {
    await withStream.uploadStream(stream);
    return true;
  } catch (error) {
    await deleteBlobQuiet(blob);
    throw error;
  }
}

async function writeStreamBuffered(
  ctx: AzureContext,
  path: string,
  stream: Readable,
  blob: ReturnType<ContainerClient["getBlockBlobClient"]>,
): Promise<void> {
  try {
    const data = await collectStream(stream);
    await azureWrite(ctx, path, data);
  } catch (error) {
    await deleteBlobQuiet(blob);
    throw error;
  }
}
