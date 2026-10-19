/**
 * Validate and apply a baseline archive (format v1).
 *
 * All-or-nothing validation: the manifest, every identity (through the same
 * segment checks as {@link baselinePath}), every image's size, PNG signature
 * and SHA-256 are verified before the first write. Storage paths are always
 * derived from the manifest identity — never from zip entry names.
 */
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import type { StorageAdapter } from "../adapters/storage.ts";
import { baselinePath, contentPath } from "../utils/paths.ts";
import { readZip, ZipFormatError, type ZipEntry } from "../utils/zip-read.ts";
import {
  BASELINE_ARCHIVE_LIMITS,
  BASELINE_MANIFEST_NAME,
  BaselineArchiveError,
  baselineIdentity,
  baselineManifestSchema,
  isPng,
  type BaselineManifest,
  type BaselineManifestEntry,
} from "./baseline-archive.ts";

/** A validated baseline ready to write. */
export interface PlannedBaseline {
  entry: BaselineManifestEntry;
  /** Content-addressed destination inside the importing project. */
  storagePath: string;
  zipEntry: ZipEntry;
  /** The verified PNG bytes, extracted once during planning. */
  data: Buffer;
}

/**
 * Parse and fully validate `archive` for import into `projectId`. Inflating and
 * hashing is CPU-bound, so the loop yields to the event loop between entries
 * instead of blocking the server for the whole archive.
 *
 * @throws {BaselineArchiveError} On any malformed, unsafe, or inconsistent input.
 */
export async function planBaselineImport(
  archive: Buffer,
  projectId: string,
): Promise<PlannedBaseline[]> {
  const entries = openArchive(archive);
  const manifest = parseManifest(entries);
  const seen = new Set<string>();
  const plan: PlannedBaseline[] = [];
  for (const entry of manifest.baselines) {
    claimEntry(seen, entry);
    plan.push(planEntry(entries, projectId, entry));
    // oxlint-disable-next-line eslint/no-await-in-loop -- deliberate yield between CPU-bound entries
    await setImmediate();
  }
  return plan;
}

/** Reject repeated identities or files, so total work stays bounded by the archive's own size limit. */
function claimEntry(seen: Set<string>, entry: BaselineManifestEntry): void {
  const keys = [baselineIdentity(entry), `file:${entry.file}`];
  if (keys.some((key) => seen.has(key))) {
    fail(`Duplicate baseline or file in manifest: ${entry.file}`);
  }
  for (const key of keys) {
    seen.add(key);
  }
}

/** Write a planned baseline's image to storage. */
export async function writePlannedImage(
  storage: StorageAdapter,
  planned: PlannedBaseline,
): Promise<void> {
  if (!(await storage.exists(planned.storagePath))) {
    await storage.write(planned.storagePath, planned.data);
  }
}

function fail(message: string): never {
  throw new BaselineArchiveError(message);
}

function openArchive(archive: Buffer): Map<string, ZipEntry> {
  try {
    return readZip(archive, {
      maxEntries: BASELINE_ARCHIVE_LIMITS.maxBaselines + 1,
      maxEntryBytes: Math.max(
        BASELINE_ARCHIVE_LIMITS.maxImageBytes,
        BASELINE_ARCHIVE_LIMITS.maxManifestBytes,
      ),
      maxTotalBytes: BASELINE_ARCHIVE_LIMITS.maxArchiveBytes,
    });
  } catch (error) {
    if (error instanceof ZipFormatError) {
      fail(error.message);
    }
    throw error;
  }
}

function parseManifest(entries: Map<string, ZipEntry>): BaselineManifest {
  const file = entries.get(BASELINE_MANIFEST_NAME);
  if (!file) {
    fail(`Archive has no ${BASELINE_MANIFEST_NAME}`);
  }
  if (file.size > BASELINE_ARCHIVE_LIMITS.maxManifestBytes) {
    fail(`${BASELINE_MANIFEST_NAME} exceeds ${BASELINE_ARCHIVE_LIMITS.maxManifestBytes} bytes`);
  }
  const parsed = baselineManifestSchema.safeParse(parseJson(file.read().toString("utf8")));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail(
      `Invalid ${BASELINE_MANIFEST_NAME}: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`,
    );
  }
  return parsed.data;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail(`${BASELINE_MANIFEST_NAME} is not valid JSON`);
  }
}

function planEntry(
  entries: Map<string, ZipEntry>,
  projectId: string,
  entry: BaselineManifestEntry,
): PlannedBaseline {
  const zipEntry = entries.get(entry.file);
  if (!zipEntry || entry.file === BASELINE_MANIFEST_NAME) {
    fail(`Archive is missing ${entry.file}`);
  }
  if (zipEntry.size > BASELINE_ARCHIVE_LIMITS.maxImageBytes) {
    fail(`${entry.file} exceeds ${BASELINE_ARCHIVE_LIMITS.maxImageBytes} bytes`);
  }
  assertSafeIdentity(projectId, entry);
  const data = verifiedImage(zipEntry, entry);
  const storagePath = contentPath(projectId, createHash("sha256").update(data).digest("hex"));
  return { entry, storagePath, zipEntry, data };
}

/** The identity only has to be safe here: the image itself is stored by content. */
function assertSafeIdentity(projectId: string, entry: BaselineManifestEntry): void {
  try {
    baselinePath(projectId, entry.branch, entry.storyId, entry.viewport, entry.browser);
  } catch {
    fail(`Unsafe baseline identity for ${entry.file}`);
  }
}

function verifiedImage(zipEntry: ZipEntry, entry: BaselineManifestEntry): Buffer {
  const data = readEntry(zipEntry);
  if (!isPng(data)) {
    fail(`${entry.file} is not a PNG`);
  }
  if (createHash("sha256").update(data).digest("hex") !== entry.sha256) {
    fail(`${entry.file} does not match its manifest checksum`);
  }
  return data;
}

function readEntry(zipEntry: ZipEntry): Buffer {
  try {
    return zipEntry.read();
  } catch (error) {
    if (error instanceof ZipFormatError) {
      return fail(error.message);
    }
    throw error;
  }
}
