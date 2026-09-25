import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Parse, type Entry } from "unzipper";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { DatabaseAdapter } from "../db/database.ts";
import { storybookDir, storybookZipPath } from "../utils/paths.ts";

/**
 * Shared Storybook statics handling: unzip a stored build into a scratch
 * directory and persist the extracted files back to storage. Used by the
 * capture orchestrator and by the upload path for opt-in inline extraction
 * (`maxInlineUnzipSize`); both write identical keys, so either may run first.
 */

/**
 * Extract a build's stored zip into a dedicated scratch directory.
 *
 * @param storage - Storage holding the uploaded zip.
 * @param scratchDir - Root under which per-build scratch dirs are created.
 * @param projectId - Owning project id.
 * @param buildId - Build whose zip to extract.
 * @returns The extracted Storybook directory.
 */
export async function extractStorybookToScratch(
  storage: StorageAdapter,
  scratchDir: string,
  projectId: string,
  buildId: string,
): Promise<string> {
  const targetDir = join(scratchDir, projectId, "builds", buildId, "storybook");
  const root = await prepareTargetDir(targetDir);
  const source = await storage.readStream(storybookZipPath(projectId, buildId));
  const writes: Promise<void>[] = [];
  const parseError = await runParser(root, source, writes);
  if (parseError) {
    throw parseError;
  }
  await awaitWrites(writes);
  return targetDir;
}

/** Reset a scratch target directory, returning its resolved root. */
async function prepareTargetDir(targetDir: string): Promise<string> {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  return resolve(targetDir);
}

/** Await streamed zip writes, throwing the first write failure. */
async function awaitWrites(writes: Promise<void>[]): Promise<void> {
  const outcomes = await Promise.allSettled(writes);
  const writeError = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (writeError) {
    throw writeError.reason;
  }
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
  await Promise.all(
    files.map(async (file) => {
      const rel = relative(root, file);
      const buffer = await readFile(file);
      const hash = await hashBuffer(buffer);
      const contentPath = `content/${hash}`;
      manifest[rel] = hash;
      // Only write if not already exists (dedup)
      if (!(await storage.exists(contentPath))) {
        await storage.write(contentPath, buffer);
      }
      // Also write to legacy per-build path for backward compat (can be removed after migration)
      // and maintain content_refs for GC
      await storage.write(`${destinationPrefix}/${rel}`, buffer);
      if (db) {
        await upsertContentRef(db, hash);
      }
    }),
  );
  await storage.write(`${destinationPrefix}/manifest.json`, Buffer.from(JSON.stringify(manifest)));
}

async function hashBuffer(buffer: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(buffer).digest("hex");
}

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

function blockedTarget(root: string, entryName: string): boolean {
  const candidate = resolve(join(root, entryName));
  return candidate !== root && !candidate.startsWith(root + sep);
}

/** Pipe one zip entry to disk, tracking the write for later aggregation. */
function handleEntry(
  root: string,
  entry: Entry,
  writes: Promise<void>[],
  fail: (error: unknown) => void,
): void {
  if (blockedTarget(root, entry.path)) {
    entry.autodrain();
    fail(new Error(`Blocked path traversal in uploaded Storybook: ${entry.path}`));
    return;
  }
  if (entry.type === "Directory") {
    entry.autodrain();
    return;
  }
  writeEntry(root, entry, writes);
}

/** Stream one zip entry to disk, tracking the write for later aggregation. */
function writeEntry(root: string, entry: Entry, writes: Promise<void>[]): void {
  const target = join(root, entry.path);
  const done = (async (): Promise<void> => {
    await mkdir(dirname(target), { recursive: true });
    await pipeline(entry, createWriteStream(target));
  })();
  writes.push(done);
  done.catch(() => {}); // Intentionally empty — aggregated via allSettled by the caller
}

/** Run the unzipper parser, resolving with the first parse error (or null). */
// oxlint-disable-next-line typescript/promise-function-async -- executor-style promise wrapper around events
function runParser(
  root: string,
  source: import("node:stream").Readable,
  writes: Promise<void>[],
): Promise<unknown> {
  return new Promise((settle) => {
    const parser = Parse();
    const fail = (error: unknown): void => {
      source.destroy();
      settle(error);
    };
    parser.on("entry", (entry: Entry) => {
      handleEntry(root, entry, writes, fail);
    });
    parser.on("error", fail);
    parser.on("close", () => {
      settle(null);
    });
    source.on("error", fail);
    source.pipe(parser);
  });
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
