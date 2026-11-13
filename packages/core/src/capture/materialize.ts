/**
 * Fill a scratch folder with a published build's Storybook from its `manifest.json` and the shared
 * `content/<hash>` blobs, so capture, shards and retries never read `storybook.zip` (issue #859).
 *
 * The tree is built beside its final place and renamed into it, so a reader (another copy of the
 * process sharing the scratch root) sees either no `storybook` directory or a complete one. A marker
 * written before the rename names the manifest it holds; a later call for the same build on the same
 * host reuses the tree instead of reading the blobs again.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { StorageAdapter } from "../adapters/storage.ts";
import { mapLimit } from "../utils/map-limit.ts";
import { isPathSafe, isSafeSegment } from "../utils/path-security.ts";
import { contentKey, storybookDir } from "../utils/paths.ts";
import { parseManifest } from "./catalog/manifest-cache.ts";
import { ZipInvalidError } from "./publish/invalid-zip.ts";
import {
  DEFAULT_MAX_UNZIPPED_BYTES,
  DEFAULT_MAX_ZIP_ENTRIES,
  ZipLimitError,
  type ExtractionLimits,
} from "./publish/limits.ts";
import { jobScratchDir, shardScratchDir } from "./scratch.ts";
import { extractStorybookToScratch } from "./statics.ts";

/** Blobs read and written at once; bounds how many file buffers are in memory together. */
const MATERIALIZE_CONCURRENCY = 8;

/** Name of the Storybook directory inside a job's or shard's scratch directory. */
export const STORYBOOK_DIRNAME = "storybook";

/** Name of the marker beside the directory: the digest of the manifest the directory holds. */
export const COMPLETE_MARKER = "storybook.complete";

/** What {@link materializeStorybook} takes beyond where the build is. */
export interface MaterializeOptions {
  /** Shard materializing it; omitted for the build's own job. */
  shardId?: string | undefined;
  /** Entry and byte caps; the manifest is checked against them like a zip. */
  limits?: ExtractionLimits | undefined;
  /** Once aborted, nothing more is written and the partial tree is removed. */
  signal?: AbortSignal | undefined;
}

/**
 * Materialize a build's Storybook into scratch from its manifest.
 *
 * @returns The Storybook directory, or `null` when the build has no manifest yet (the caller falls
 *   back to the zip).
 * @throws {ZipInvalidError} When the manifest holds an unsafe path or a bad hash, or a blob does not
 *   match its hash.
 * @throws {ZipLimitError} When the manifest or the files break the caps.
 */
export async function materializeStorybook(
  storage: StorageAdapter,
  scratchDir: string,
  projectId: string,
  buildId: string,
  options: MaterializeOptions = {},
): Promise<string | null> {
  options.signal?.throwIfAborted();
  const read = await readManifest(storage, projectId, buildId);
  if (!read) {
    return null;
  }
  const base = baseDirOf(scratchDir, projectId, buildId, options.shardId);
  await ensureTree(storage, base, read, options);
  return join(base, STORYBOOK_DIRNAME);
}

/** Reuse the tree in `base` when it holds this manifest, else build it. */
async function ensureTree(
  storage: StorageAdapter,
  base: string,
  read: { manifest: ReadonlyMap<string, string>; digest: string },
  options: MaterializeOptions,
): Promise<void> {
  if (await isComplete(base, read.digest)) {
    return;
  }
  const target = join(base, STORYBOOK_DIRNAME);
  const limits = options.limits ?? DEFAULT_LIMITS;
  const entries = checkedEntries(read.manifest, limits, resolve(target));
  await install(storage, {
    base,
    target,
    digest: read.digest,
    entries,
    limits,
    signal: options.signal,
  });
}

function baseDirOf(
  scratchDir: string,
  projectId: string,
  buildId: string,
  shardId: string | undefined,
): string {
  return shardId
    ? shardScratchDir(scratchDir, projectId, buildId, shardId)
    : jobScratchDir(scratchDir, projectId, buildId);
}

/** The build's manifest and the digest of its bytes, or null when it has none. */
async function readManifest(
  storage: StorageAdapter,
  projectId: string,
  buildId: string,
): Promise<{ manifest: ReadonlyMap<string, string>; digest: string } | null> {
  const key = `${storybookDir(projectId, buildId)}/manifest.json`;
  if (!(await storage.exists(key))) {
    return null;
  }
  const bytes = await storage.read(key);
  const manifest = parseManifest(bytes);
  if (!manifest) {
    throw new ZipInvalidError("Storybook manifest is not a JSON object");
  }
  return { manifest, digest: createHash("sha256").update(bytes).digest("hex") };
}

const DEFAULT_LIMITS: ExtractionLimits = {
  maxEntries: DEFAULT_MAX_ZIP_ENTRIES,
  maxBytes: DEFAULT_MAX_UNZIPPED_BYTES,
};

/** The manifest's files after the checks, as `[relative path, hash]`. */
function checkedEntries(
  manifest: ReadonlyMap<string, string>,
  limits: ExtractionLimits,
  root: string,
): [string, string][] {
  if (manifest.size > limits.maxEntries) {
    throw new ZipLimitError(`Storybook has more than ${limits.maxEntries} files`);
  }
  const entries = [...manifest];
  for (const [rel, hash] of entries) {
    if (!isSafeRelativePath(rel) || !isPathSafe(root, resolve(root, rel))) {
      throw new ZipInvalidError("Storybook manifest holds an unsafe path");
    }
    contentKeyOrInvalid(hash);
  }
  return entries;
}

/** The same rules as `publishedRelativePath`: no empty, `.` or `..` segment, backslash or NUL. */
function isSafeRelativePath(rel: string): boolean {
  return rel
    .split("/")
    .every(
      (segment) =>
        segment !== "" && segment !== "." && !segment.includes("\0") && isSafeSegment(segment),
    );
}

function contentKeyOrInvalid(hash: string): string {
  try {
    return contentKey(hash);
  } catch {
    throw new ZipInvalidError("Storybook manifest holds an invalid content hash");
  }
}

async function isComplete(base: string, digest: string): Promise<boolean> {
  try {
    const marker = await readFile(join(base, COMPLETE_MARKER), "utf8");
    return marker === digest && (await stat(join(base, STORYBOOK_DIRNAME))).isDirectory();
  } catch {
    return false;
  }
}

interface Install {
  base: string;
  target: string;
  digest: string;
  entries: [string, string][];
  limits: ExtractionLimits;
  signal: AbortSignal | undefined;
}

/** Build the tree beside its place, then publish it with one rename. The partial tree never outlives the call. */
async function install(storage: StorageAdapter, plan: Install): Promise<void> {
  const { base, target, digest, signal } = plan;
  const partial = join(base, `${STORYBOOK_DIRNAME}.partial-${randomBytes(6).toString("hex")}`);
  try {
    await clearPrevious(base, target);
    await mkdir(partial, { recursive: true });
    await fill(storage, partial, plan);
    signal?.throwIfAborted();
    await writeFile(join(base, COMPLETE_MARKER), digest);
    await publish(partial, base, digest);
  } finally {
    await rm(partial, { recursive: true, force: true });
  }
}

/** Drop a stale marker and tree (a zip extraction, or another manifest) before building a new one. */
async function clearPrevious(base: string, target: string): Promise<void> {
  await rm(join(base, COMPLETE_MARKER), { force: true });
  await rm(target, { recursive: true, force: true });
}

/** Rename the finished tree into place; losing the race to another copy's identical tree is fine. */
async function publish(partial: string, base: string, digest: string): Promise<void> {
  try {
    await rename(partial, join(base, STORYBOOK_DIRNAME));
  } catch (error) {
    // The winner's tree is complete: it is only ever renamed whole.
    if (!(await isComplete(base, digest))) {
      throw error;
    }
  }
}

async function fill(storage: StorageAdapter, partial: string, plan: Install): Promise<void> {
  const { entries, limits, signal } = plan;
  let total = 0;
  await mapLimit(entries, MATERIALIZE_CONCURRENCY, async ([rel, hash]) => {
    signal?.throwIfAborted();
    const data = await readBlob(storage, hash);
    total += data.length;
    if (total > limits.maxBytes) {
      throw new ZipLimitError(`Storybook is larger than ${limits.maxBytes} bytes`);
    }
    const file = join(partial, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  });
}

async function readBlob(storage: StorageAdapter, hash: string): Promise<Buffer> {
  // A storage failure (including a missing blob) is not wrapped: the job retries it.
  const data = await storage.read(contentKeyOrInvalid(hash));
  if (createHash("sha256").update(data).digest("hex") !== hash) {
    throw new ZipInvalidError("Storybook content blob does not match its hash");
  }
  return data;
}

/**
 * The build's Storybook in scratch: materialized from its manifest when it has one, else extracted
 * from `storybook.zip` (a build still publishing, or one published before manifests).
 */
export async function prepareStorybook(
  storage: StorageAdapter,
  scratchDir: string,
  projectId: string,
  buildId: string,
  options: MaterializeOptions = {},
): Promise<string> {
  const dir = await materializeStorybook(storage, scratchDir, projectId, buildId, options);
  return (
    dir ??
    (await extractStorybookToScratch(
      storage,
      scratchDir,
      projectId,
      buildId,
      options.shardId,
      options.limits,
      options.signal,
    ))
  );
}
