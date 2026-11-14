/**
 * Read-only storage consistency check for operators (backup and restore, ADR 0039). It reports what
 * rows reference but storage lacks, and counts shared blobs nothing references. It never writes or
 * deletes; collection stays with the fenced lifecycle. A result names counts and build ids, never
 * a storage path or a content hash.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import { contentKey } from "../utils/paths.ts";
import { readManifestHashes } from "./build-deletion.ts";

/** What the check needs. */
export interface StorageCheckDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
}

/** Options of {@link checkStorage}. */
export interface StorageCheckOptions {
  /** Check at most this many live builds (newest ids first); omit to walk every build. */
  sample?: number;
}

/** A build whose manifest names blobs that storage lacks. */
export interface BuildMissingBlobs {
  buildId: string;
  /** How many distinct blobs the manifest names that storage lacks. */
  missing: number;
}

/** The answer of {@link checkStorage}. */
export interface StorageCheckResult {
  buildsChecked: number;
  baselinesChecked: number;
  /** Builds whose manifest is missing blobs, or could not be read (`unreadable`). */
  builds: BuildMissingBlobs[];
  unreadableManifests: string[];
  missingBaselineImages: number;
  /** Shared blobs no live manifest names. Informational: retention collects them after its grace. */
  unreferencedBlobs: number;
  /** True when `sample` left builds out, so `unreferencedBlobs` is not trustworthy and is 0. */
  sampled: boolean;
}

interface BuildRow {
  id: string;
  projectId: string;
  retentionState?: string;
}

/** Walk (or sample) live builds and baselines and report what is missing or unreferenced. */
export async function checkStorage(
  deps: StorageCheckDeps,
  options: StorageCheckOptions = {},
): Promise<StorageCheckResult> {
  const all = (await deps.db.list(deps.db.tables.builds)) as unknown as BuildRow[];
  const live = all.filter((build) => build.retentionState !== "deleting");
  const picked =
    options.sample === undefined
      ? live
      : live.toSorted((a, b) => b.id.localeCompare(a.id)).slice(0, options.sample);
  const findings = await walkBuilds(deps, picked);
  const sampled = picked.length < live.length;
  const baselines = await checkBaselines(deps);
  const complete = !sampled && findings.unreadableManifests.length === 0;
  return {
    buildsChecked: picked.length,
    baselinesChecked: baselines.checked,
    builds: findings.builds,
    unreadableManifests: findings.unreadableManifests,
    missingBaselineImages: baselines.missing,
    unreferencedBlobs: complete ? await countUnreferenced(deps, findings.referenced) : 0,
    sampled,
  };
}

interface Findings {
  referenced: Set<string>;
  builds: BuildMissingBlobs[];
  unreadableManifests: string[];
}

async function walkBuilds(deps: StorageCheckDeps, picked: BuildRow[]): Promise<Findings> {
  const findings: Findings = { referenced: new Set(), builds: [], unreadableManifests: [] };
  for (const build of picked) {
    // oxlint-disable-next-line no-await-in-loop -- one manifest at a time keeps storage load flat
    await checkBuild(deps, build, findings);
  }
  return findings;
}

async function checkBuild(
  deps: StorageCheckDeps,
  build: BuildRow,
  findings: Findings,
): Promise<void> {
  const hashes = await manifestOf(deps, build);
  if (hashes === null) {
    findings.unreadableManifests.push(build.id);
    return;
  }
  const present = await Promise.all(
    hashes.map(async (hash) => await blobExists(deps.storage, hash)),
  );
  for (const hash of hashes) findings.referenced.add(hash);
  const missing = present.filter((ok) => !ok).length;
  if (missing > 0) findings.builds.push({ buildId: build.id, missing });
}

async function manifestOf(deps: StorageCheckDeps, build: BuildRow): Promise<string[] | null> {
  try {
    return await readManifestHashes(deps, build.projectId, build.id);
  } catch {
    return null;
  }
}

/** A hash that is not a content hash counts as missing: the row names something nothing can serve. */
async function blobExists(storage: StorageAdapter, hash: string): Promise<boolean> {
  try {
    return await storage.exists(contentKey(hash));
  } catch {
    return false;
  }
}

async function checkBaselines(
  deps: StorageCheckDeps,
): Promise<{ checked: number; missing: number }> {
  const rows = (await deps.db.list(deps.db.tables.baselines)) as unknown as {
    screenshotPath?: string;
  }[];
  const paths = rows
    .map((row) => row.screenshotPath)
    .filter((path): path is string => Boolean(path));
  const present = await Promise.all(paths.map(async (path) => await deps.storage.exists(path)));
  return { checked: paths.length, missing: present.filter((ok) => !ok).length };
}

/** Count `content/` blobs no walked manifest names (callers ask only after a full, readable walk). */
async function countUnreferenced(deps: StorageCheckDeps, referenced: Set<string>): Promise<number> {
  const stored = await deps.storage.list("content/");
  return stored.filter((key) => !referenced.has(key.slice("content/".length))).length;
}
