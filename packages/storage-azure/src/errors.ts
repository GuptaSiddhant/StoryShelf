import type { ContainerClient } from "@azure/storage-blob";
import { Readable } from "node:stream";

/** Not-found guards and stream/collect helpers for Azure blob I/O. */

/** True when an Azure SDK error means the blob (or container) is missing. */
export function isNotFound(error: unknown): boolean {
  const err = error as { statusCode?: number; code?: string };
  if (err.statusCode === 404) {
    return true;
  }
  return err.code === "BlobNotFound" || err.code === "ContainerNotFound" || err.code === "404";
}

/** Download a blob through the `download()` response stream. */
export async function collectDownload(
  blob: ReturnType<ContainerClient["getBlockBlobClient"]>,
): Promise<Buffer> {
  const response = await blob.download();
  const body = response.readableStreamBody as unknown as Readable | undefined;
  if (!body) {
    return Buffer.alloc(0);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** Buffer an incoming readable into a single Buffer. */
export async function collectStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** Best-effort blob delete used to clean up after failed stream uploads. */
export async function deleteBlobQuiet(
  blob: ReturnType<ContainerClient["getBlockBlobClient"]>,
): Promise<void> {
  try {
    const withDelete = blob as unknown as {
      deleteIfExists?: () => Promise<void>;
      delete?: () => Promise<void>;
    };
    if (typeof withDelete.deleteIfExists === "function") {
      await withDelete.deleteIfExists();
      return;
    }
    await withDelete.delete?.();
  } catch {
    // ignore - best-effort cleanup
  }
}
