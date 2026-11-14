/**
 * Publish-time compressed copies: when a build finishes publishing, make the gzip and brotli copy of
 * each of its compressible files, so the first request is already served compressed. Work is
 * background and bounded: one build at a time per storage, a short backlog, one file at a time.
 */
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { loadManifest } from "@storyshelf/core/capture";
import type { Logger } from "@storyshelf/core/logger";
import { contentKey, mimeFor, storybookDir } from "@storyshelf/core/utils";
import type { VariantEncoding } from "./accept-encoding.ts";
import { eligible, generate, hasVariant, isCompressible } from "./published-compression.ts";

/** Smaller files cost more in headers and a lookup than compression saves. */
export const MIN_PRECOMPRESS_BYTES = 1024;
const MAX_BACKLOG = 8;
const ENCODINGS: readonly VariantEncoding[] = ["br", "gzip"];

interface Queue {
  /** Every build queued so far, run one after another. */
  chain: Promise<void>;
  /** Builds queued or running. */
  pending: number;
}
const queues = new WeakMap<StorageAdapter, Queue>();

/**
 * Compress a published build's files in the background. Returns at once; a backlog beyond
 * {@link MAX_BACKLOG} builds is dropped (those files get their copy on first request instead).
 */
export function precompressBuild(
  storage: StorageAdapter,
  projectId: string,
  buildId: string,
  logger: Logger,
): void {
  const queue = queues.get(storage) ?? { chain: Promise.resolve(), pending: 0 };
  queues.set(storage, queue);
  if (queue.pending >= MAX_BACKLOG) return;
  queue.pending += 1;
  queue.chain = queue.chain
    .then(async () => {
      await precompressFiles(storage, projectId, buildId);
    })
    .catch((error: unknown) => {
      logger.warn({ err: error, buildId }, "publish-time compression failed");
    })
    .finally(() => {
      queue.pending -= 1;
    });
}

/** Resolves once everything queued for the storage has run (for tests and shutdown). */
export async function settlePrecompression(storage: StorageAdapter): Promise<void> {
  await queues.get(storage)?.chain;
}

async function precompressFiles(
  storage: StorageAdapter,
  projectId: string,
  buildId: string,
): Promise<void> {
  const manifest = await loadManifest(storage, storybookDir(projectId, buildId));
  const seen = new Set<string>();
  for (const [rel, hash] of manifest ?? []) {
    const mime = mimeFor(rel);
    if (seen.has(hash) || !isCompressible(mime)) continue;
    seen.add(hash);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time bounds memory
    await precompressFile(storage, hash, mime);
  }
}

async function precompressFile(storage: StorageAdapter, hash: string, mime: string): Promise<void> {
  const missing = (
    await Promise.all(
      ENCODINGS.map(async (encoding) =>
        (await hasVariant(storage, hash, encoding)) ? null : encoding,
      ),
    )
  ).filter((encoding) => encoding !== null);
  if (missing.length === 0) return;
  const original = await storage.read(contentKey(hash)).catch(() => null);
  if (!original || original.length < MIN_PRECOMPRESS_BYTES || !eligible(hash, original, mime))
    return;
  for (const encoding of missing) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the two copies share one read
    await generate(storage, hash, original, encoding);
  }
}
