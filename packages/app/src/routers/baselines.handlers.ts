/** HTTP helpers for the baseline export/import router. */
import { DEFAULT_MAX_UPLOAD_BYTES, type ShelfConfig } from "@storyshelf/core/config";
import { HTTPException } from "hono/http-exception";

/** Ceiling for a buffered import archive, whatever `maxUploadBytes` allows. */
export const MAX_BASELINE_IMPORT_BYTES = 512 * 1024 * 1024;

/** Byte limit for an import body: `maxUploadBytes`, capped because the archive is buffered. */
export function importByteLimit(config: Pick<ShelfConfig, "maxUploadBytes">): number {
  return Math.min(config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES, MAX_BASELINE_IMPORT_BYTES);
}

/**
 * Buffer a request body, failing fast with 413 once it passes `maxBytes`
 * (checked against `content-length` up front and while streaming).
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) {
    throw tooLarge(maxBytes);
  }
  if (!request.body) {
    throw new HTTPException(400, { message: "Missing request body" });
  }
  return await collectCapped(request.body.getReader(), maxBytes);
}

async function collectCapped(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let seen = 0;
  let next = await reader.read();
  while (!next.done && seen <= maxBytes) {
    seen += next.value.length;
    chunks.push(next.value);
    // oxlint-disable-next-line eslint/no-await-in-loop -- reading a stream is inherently sequential
    next = await reader.read();
  }
  if (seen > maxBytes) {
    await abortTooLarge(reader, maxBytes);
  }
  return Buffer.concat(chunks);
}

async function abortTooLarge(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
): Promise<never> {
  await reader.cancel();
  throw tooLarge(maxBytes);
}

function tooLarge(maxBytes: number): HTTPException {
  return new HTTPException(413, { message: `Archive exceeds ${maxBytes} bytes` });
}

/** Adapt a lazily produced chunk sequence to a pull-based web stream. */
export function toWebStream(chunks: AsyncIterable<Buffer>): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
      } else {
        controller.enqueue(new Uint8Array(next.value));
      }
    },
    async cancel(): Promise<void> {
      await iterator.return?.();
    },
  });
}

/** Download file name: `<slug>-baselines[-<branch>].zip`, header-safe. */
export function archiveFileName(slug: string, branch?: string): string {
  const base = branch ? `${slug}-baselines-${branch}` : `${slug}-baselines`;
  return `${base.replaceAll(/[^\w.-]+/gu, "_")}.zip`;
}
