import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { mapLimit } from "../utils/map-limit.ts";
import { storybookDir, storybookZipPath } from "../utils/paths.ts";
import { extractZipStream } from "./publish/extract.ts";
import {
  DEFAULT_MAX_UNZIPPED_BYTES,
  DEFAULT_MAX_ZIP_ENTRIES,
  type ExtractionLimits,
} from "./publish/limits.ts";
import { jobScratchDir, shardScratchDir } from "./scratch.ts";

/**
 * Shared Storybook statics handling: unzip a stored build into a scratch
 * directory and persist the extracted files back to storage. Used by the
 * capture orchestrator and by the upload path for opt-in inline extraction
 * (`maxInlineUnzipSize`); both write identical keys, so either may run first.
 */

const DEFAULT_EXTRACTION_LIMITS: ExtractionLimits = {
  maxEntries: DEFAULT_MAX_ZIP_ENTRIES,
  maxBytes: DEFAULT_MAX_UNZIPPED_BYTES,
};

/**
 * Extract a build's stored zip into a dedicated scratch directory. The caller removes it when
 * done (`removeJobScratch`).
 *
 * @param storage - Storage holding the uploaded zip.
 * @param scratchDir - Root under which per-build scratch dirs are created.
 * @param projectId - Owning project id.
 * @param buildId - Build whose zip to extract.
 * @param shardId - Shard extracting it; gives the shard a directory of its own.
 * @param limits - Entry and uncompressed-byte caps (safe defaults when omitted).
 * @returns The extracted Storybook directory.
 * @throws {ZipLimitError} When the archive breaks a cap or escapes the target directory.
 */
export async function extractStorybookToScratch(
  storage: StorageAdapter,
  scratchDir: string,
  projectId: string,
  buildId: string,
  shardId?: string,
  limits: ExtractionLimits = DEFAULT_EXTRACTION_LIMITS,
): Promise<string> {
  const base = shardId
    ? shardScratchDir(scratchDir, projectId, buildId, shardId)
    : jobScratchDir(scratchDir, projectId, buildId);
  const targetDir = join(base, "storybook");
  const root = await prepareTargetDir(targetDir);
  const source = await storage.readStream(storybookZipPath(projectId, buildId));
  await extractZipStream(source, root, limits);
  return targetDir;
}

/** Reset a scratch target directory, returning its resolved root. */
async function prepareTargetDir(targetDir: string): Promise<string> {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  return resolve(targetDir);
}

/**
 * Persist an extracted Storybook directory to storage for published serving.
 *
 * Uses content-addressed deduplication: each file is hashed and stored once
 * under `content/<hash>`, with a per-build manifest at
 * `${projectId}/builds/${buildId}/storybook/manifest.json`.
 *
 * @param storage - Destination storage adapter.
 * @param sourceDir - Extracted Storybook directory.
 * @param projectId - Owning project id.
 * @param buildId - Build the files belong to.
 * @param db - Optional database for content ref tracking (enables GC).
 */
export async function persistStorybookStatics(
  storage: StorageAdapter,
  sourceDir: string,
  projectId: string,
  buildId: string,
  db?: DatabaseAdapter,
): Promise<void> {
  const root = resolve(sourceDir);
  const destinationPrefix = storybookDir(projectId, buildId);
  const files = await walkFiles(root);
  const manifest: Record<string, string> = {};
  // Bounded: a large Storybook has thousands of files, and buffering them all
  // at once exhausts memory on small hosts. Each file is read fully before any
  // write: the scratch dir is often the storage root, so the per-build path
  // below can be the very file being read (a streamed write would truncate it).
  await mapLimit(files, STATICS_CONCURRENCY, async (file) => {
    const rel = relative(root, file);
    const buffer = await readFile(file);
    const hash = createHash("sha256").update(buffer).digest("hex");
    manifest[rel] = hash;
    // Only write if not already exists (dedup)
    if (!(await storage.exists(`content/${hash}`))) {
      await storage.write(`content/${hash}`, buffer);
    }
    // Also write to legacy per-build path for backward compat (can be removed after migration)
    // and maintain content_refs for GC
    await storage.write(`${destinationPrefix}/${rel}`, buffer);
    if (db) {
      await upsertContentRef(db, hash);
    }
  });
  await storage.write(`${destinationPrefix}/manifest.json`, Buffer.from(JSON.stringify(manifest)));
}

/** Files persisted at once; bounds how many file buffers are in memory together. */
const STATICS_CONCURRENCY = 8;

async function upsertContentRef(db: DatabaseAdapter, hash: string): Promise<void> {
  try {
    const contentRefs = db.tables.contentRefs;
    const now = new Date().toISOString();
    const existing = (await db.get(contentRefs, hash)) as unknown as { refCount: number } | null;
    if (existing) {
      await db.update(contentRefs, hash, {
        refCount: existing.refCount + 1,
        lastSeenAt: now,
      });
    } else {
      await db.insert(contentRefs, { hash, refCount: 1, lastSeenAt: now, createdAt: now });
    }
  } catch {
    // content_refs table may not exist yet (old DB) — ignore
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return await walkFiles(full);
      }
      return [full];
    }),
  );
  return nested.flat();
}
