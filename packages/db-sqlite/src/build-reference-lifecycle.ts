/** SQLite's write-serialized admission and irreversible deletion claim primitive. */
import {
  BaselineSourceIntegrityError,
  ReferenceGenerationConflict,
  type BuildReferenceLifecycle,
  type BuildReferenceOwner,
  type FencedBuildReferenceChange,
  type TxStore,
} from "@storyshelf/core/adapter/database";
import { resolveBaselineOrigin } from "@storyshelf/core/models";
import type { Baseline, Build, Snapshot } from "@storyshelf/core/schema";
import { DatabaseSync } from "node:sqlite";
import {
  completeDeletion,
  listDeleting,
  markStorageDeleted,
  releaseBuildContent,
} from "./build-deletion-steps.ts";
import {
  abandonContentClaim,
  claimContent,
  finishContentCollection,
  holdsContentClaim,
  contentUsage,
  recordContentUses,
} from "./content-uses.ts";
import { inTransaction, open, rollbackQuietly, transactionStore } from "./lifecycle-transaction.ts";
import { schema } from "./schema/index.ts";

/** Not yet exposed by the adapter: all domain mutations and cleanup must be wired first. */
export function createBuildReferenceLifecycle(
  path: string,
  onContention?: () => void,
): BuildReferenceLifecycle {
  return {
    referenceGeneration: async (owner) => await referenceGeneration(path, owner),
    replaceManyFencedReferences: async (changes, writeDomain) =>
      await replaceManyFencedReferences(path, changes, writeDomain),
    replaceFencedReferences: async (owner, generation, ids, writeDomain) =>
      await replaceFencedReferences(path, owner, generation, ids, writeDomain),
    claimDeletion: async (projectId, buildId) =>
      await claimDeletion(path, projectId, buildId, onContention),
    listDeleting: async (projectId) => await listDeleting(path, projectId),
    releaseBuildContent: async (projectId, buildId, hashes) =>
      await releaseBuildContent(path, projectId, buildId, hashes),
    markStorageDeleted: async (projectId, buildId) =>
      await markStorageDeleted(path, projectId, buildId),
    completeDeletion: async (projectId, buildId, removeRows) =>
      await completeDeletion(path, projectId, buildId, removeRows),
    recordContentUses: async (projectId, buildId, hashes, staleBefore, sizes) =>
      await recordContentUses(path, projectId, buildId, hashes, staleBefore, sizes),
    contentUsage: async (projectId) => await contentUsage(path, projectId),
    claimContent: async (token, idleBefore, staleBefore) =>
      await claimContent(path, token, idleBefore, staleBefore),
    holdsContentClaim: async (hash, token) => await holdsContentClaim(path, hash, token),
    abandonContentClaim: async (hash, token) => {
      await abandonContentClaim(path, hash, token);
    },
    finishContentCollection: async (hash, token) => {
      await finishContentCollection(path, hash, token);
    },
  };
}

/** What preparation did with one baseline. */
type Prepared = "protected" | "unknown" | "unavailable";

/** Counts of {@link Prepared} outcomes: every baseline with a source or a snapshot is in exactly one. */
export interface PreparationResult {
  /** Baselines whose proven source build is now pinned. */
  protected: number;
  /** Baselines whose provenance cannot be proven; they stay unpinned and unknown. */
  unknown: number;
  /** Baselines whose recorded source build row is gone; the record is kept, nothing is pinned. */
  unavailable: number;
}

/**
 * Prepare known baseline pins under the same SQLite write lock as reference admission.
 * Do not enable lifecycle-aware deletion until all writers participate in this concurrency domain.
 *
 * A recorded source whose build row is missing keeps its `source_build_id` and gets no pin
 * (`unavailable`). A recorded source that is tombstoned or belongs to another project stops the
 * whole preparation with a {@link BaselineSourceIntegrityError}; the transaction rolls back.
 */
export async function prepareBaselineReferences(
  path: string,
  beforeCommit?: () => Promise<void>,
): Promise<PreparationResult> {
  return await inTransaction(path, async (db) => {
    const rows = db
      .prepare(
        "SELECT id FROM baselines WHERE source_build_id IS NOT NULL OR snapshot_id IS NOT NULL ORDER BY id",
      )
      .all() as unknown as [string][];
    releaseOrphanedPins(db);
    const outcomes: Prepared[] = [];
    for (const [id] of rows) {
      // oxlint-disable-next-line no-await-in-loop -- one baseline at a time: a failure must stop the rest before the rollback
      outcomes.push(await prepareLegacyBaseline(db, id));
    }
    await beforeCommit?.();
    return await Promise.resolve(tally(outcomes));
  });
}

/**
 * Drop the pins of baseline owners that cannot justify one: the baseline row is gone, or it records
 * neither a source build nor a snapshot. While retention was paused (or before it existed) the
 * unfenced path could clear a baseline's provenance or delete the baseline without releasing its
 * pin, and the loop below only visits baselines that still record a source, so such a pin would
 * keep an unrelated build protected for good. A baseline that records a source is left to the loop.
 */
function releaseOrphanedPins(db: DatabaseSync): void {
  const orphaned = db
    .prepare(
      `SELECT DISTINCT r.project_id, r.owner_id FROM build_references r
       WHERE r.owner_type = 'baseline' AND NOT EXISTS (
         SELECT 1 FROM baselines b WHERE b.id = r.owner_id
           AND (b.source_build_id IS NOT NULL OR b.snapshot_id IS NOT NULL))`,
    )
    .all() as unknown as [string, string][];
  for (const [projectId, id] of orphaned) {
    db.prepare(
      "DELETE FROM build_references WHERE project_id = ? AND owner_type = 'baseline' AND owner_id = ?",
    ).run(projectId, id);
    advanceGeneration(db, { type: "baseline", id, projectId });
  }
}

function tally(outcomes: readonly Prepared[]): PreparationResult {
  const count = (kind: Prepared): number => outcomes.filter((outcome) => outcome === kind).length;
  return {
    protected: count("protected"),
    unknown: count("unknown"),
    unavailable: count("unavailable"),
  };
}

async function prepareLegacyBaseline(db: DatabaseSync, id: string): Promise<Prepared> {
  const baseline = (await transactionStore(db).get(schema.baselines, id)) as unknown as Baseline;
  if (baseline.sourceBuildId && !recordedSourcePresent(db, baseline, baseline.sourceBuildId)) {
    keepRecordUnpinned(db, baseline);
    return "unavailable";
  }
  const source = await provenSource(db, baseline);
  if (!source) {
    setPreparedSource(db, baseline, null);
    return "unknown";
  }
  protectSource(db, baseline, source.id);
  return "protected";
}

/** Pin the proven source (never a tombstone) and record it on the baseline. */
function protectSource(db: DatabaseSync, baseline: Baseline, buildId: string): void {
  pinAvailableSource(db, baseline, buildId);
  setPreparedSource(db, baseline, buildId);
}

/** The record stays (it is verified history), but nothing may pin a build for it. */
function keepRecordUnpinned(db: DatabaseSync, baseline: Baseline): void {
  if (releaseReferences(db, baseline)) advanceBaselineGeneration(db, baseline);
}

/** The build that provably rendered the baseline's image, or null when its history is incomplete. */
async function provenSource(db: DatabaseSync, baseline: Baseline): Promise<Build | null> {
  const tx = transactionStore(db);
  return await resolveBaselineOrigin(baseline, {
    baseline: async (key) => (await tx.get(schema.baselines, key)) as unknown as Baseline | null,
    snapshot: async (key) => (await tx.get(schema.snapshots, key)) as unknown as Snapshot | null,
    build: async (key) => (await tx.get(schema.builds, key)) as unknown as Build | null,
  });
}

/**
 * Whether the build a baseline records as its source still has a row. A row in another project is
 * an integrity problem, not a missing build: the record is neither kept nor cleared.
 */
function recordedSourcePresent(db: DatabaseSync, baseline: Baseline, buildId: string): boolean {
  const row = db.prepare("SELECT project_id FROM builds WHERE id = ?").get(buildId) as
    | unknown[]
    | undefined;
  if (!row) return false;
  if (row[0] !== baseline.projectId) {
    throw new BaselineSourceIntegrityError(baseline.id, buildId, "other-project");
  }
  return true;
}

function setPreparedSource(db: DatabaseSync, baseline: Baseline, source: string | null): void {
  const removed = source === null && releaseReferences(db, baseline);
  if ((baseline.sourceBuildId ?? null) === source && !removed) return;
  db.prepare("UPDATE baselines SET source_build_id = ? WHERE id = ?").run(source, baseline.id);
  advanceBaselineGeneration(db, baseline);
}

/** Drop every pin the baseline owns; true when there was one. The caller advances the generation. */
function releaseReferences(db: DatabaseSync, baseline: Baseline): boolean {
  const removed = db
    .prepare(
      "DELETE FROM build_references WHERE project_id = ? AND owner_type = 'baseline' AND owner_id = ?",
    )
    .run(baseline.projectId, baseline.id).changes;
  return removed > 0;
}

function advanceBaselineGeneration(db: DatabaseSync, baseline: Baseline): void {
  advanceGeneration(db, { type: "baseline", id: baseline.id, projectId: baseline.projectId });
}

/** Pin `buildId` for the baseline, replacing a pin on any other build; a tombstoned build is never pinned. */
function pinAvailableSource(db: DatabaseSync, baseline: Baseline, buildId: string): void {
  const { id, projectId } = baseline;
  const row = db
    .prepare("SELECT retention_state FROM builds WHERE id = ? AND project_id = ?")
    .get(buildId, projectId) as unknown[] | undefined;
  if (row?.[0] !== "available") {
    throw new BaselineSourceIntegrityError(id, buildId, "tombstoned");
  }
  const removed = db
    .prepare(
      "DELETE FROM build_references WHERE project_id = ? AND owner_type = 'baseline' AND owner_id = ? AND build_id <> ?",
    )
    .run(projectId, id, buildId).changes;
  const result = db
    .prepare(
      "INSERT OR IGNORE INTO build_references (project_id, owner_type, owner_id, build_id) VALUES (?, 'baseline', ?, ?)",
    )
    .run(projectId, id, buildId);
  if (result.changes || removed) advanceGeneration(db, { type: "baseline", id, projectId });
}

async function referenceGeneration(path: string, owner: BuildReferenceOwner): Promise<number> {
  return await inTransaction(path, async (db) => {
    const row = db
      .prepare(
        "SELECT generation FROM build_reference_generations WHERE project_id = ? AND owner_type = ? AND owner_id = ?",
      )
      .get(owner.projectId, owner.type, owner.id) as unknown[] | undefined;
    return await Promise.resolve(Number(row?.[0] ?? 0));
  });
}

/** Serialize every owner check and write with deletion claims in the SQLite write transaction. */
export async function replaceManyFencedReferences<T>(
  path: string,
  changes: readonly FencedBuildReferenceChange[],
  writeDomain: (tx: TxStore) => Promise<T>,
): Promise<{ result: T; generations: number[] }> {
  validateFencedChanges(changes);
  return await inTransaction(path, async (db) => {
    const normalized = changes.map((change) => ({
      ...change,
      ids: [...new Set(change.buildIds)].toSorted(),
    }));
    checkGenerations(db, normalized);
    const result = await writeDomain(transactionStore(db));
    for (const change of normalized) {
      saveReferences(db, change.owner, change.ids);
      advanceGeneration(db, change.owner);
    }
    return { result, generations: normalized.map((change) => change.expectedGeneration + 1) };
  });
}

function validateFencedChanges(changes: readonly FencedBuildReferenceChange[]): void {
  const keys = changes.map(({ owner }) => JSON.stringify([owner.projectId, owner.type, owner.id]));
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate reference owner");
  for (const { expectedGeneration } of changes)
    if (
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 0 ||
      expectedGeneration >= Number.MAX_SAFE_INTEGER
    )
      throw new Error("Invalid reference generation");
}

function checkGenerations(
  db: DatabaseSync,
  changes: readonly (FencedBuildReferenceChange & { ids: string[] })[],
): void {
  const select = db.prepare(
    "SELECT generation FROM build_reference_generations WHERE project_id = ? AND owner_type = ? AND owner_id = ?",
  );
  for (const change of changes) {
    const row = select.get(change.owner.projectId, change.owner.type, change.owner.id) as
      | unknown[]
      | undefined;
    if ((row?.[0] ?? 0) !== change.expectedGeneration)
      throw new ReferenceGenerationConflict("Stale reference generation");
    checkAvailable(db, change.owner.projectId, change.ids);
  }
}

/** Generation-checked owner update; the retained generation fences stale releases and retries. */
export async function replaceFencedReferences<T>(
  path: string,
  owner: BuildReferenceOwner,
  expectedGeneration: number,
  buildIds: readonly string[],
  writeDomain: (tx: TxStore) => Promise<T>,
): Promise<{ result: T; generation: number }> {
  const updated = await replaceManyFencedReferences(
    path,
    [{ owner, expectedGeneration, buildIds }],
    writeDomain,
  );
  return { result: updated.result, generation: expectedGeneration + 1 };
}

/** Every reference mutation advances the owner's fence. */
function advanceGeneration(db: DatabaseSync, owner: BuildReferenceOwner): void {
  db.prepare(
    "INSERT INTO build_reference_generations (project_id, owner_type, owner_id, generation) VALUES (?, ?, ?, 1) ON CONFLICT (project_id, owner_type, owner_id) DO UPDATE SET generation = generation + 1",
  ).run(owner.projectId, owner.type, owner.id);
}

function saveReferences(db: DatabaseSync, owner: BuildReferenceOwner, ids: string[]): void {
  db.prepare(
    "DELETE FROM build_references WHERE project_id = ? AND owner_type = ? AND owner_id = ?",
  ).run(owner.projectId, owner.type, owner.id);
  const insert = db.prepare(
    "INSERT INTO build_references (project_id, owner_type, owner_id, build_id) VALUES (?, ?, ?, ?)",
  );
  for (const id of ids) insert.run(owner.projectId, owner.type, owner.id, id);
}

function checkAvailable(db: DatabaseSync, projectId: string, ids: string[]): void {
  const select = db.prepare("SELECT retention_state FROM builds WHERE project_id = ? AND id = ?");
  for (const id of ids) {
    const row = select.get(projectId, id) as unknown[] | undefined;
    if (row?.[0] !== "available") throw new Error("Referenced build is unavailable");
  }
}

async function claimDeletion(
  path: string,
  projectId: string,
  buildId: string,
  onContention?: () => void,
): Promise<"claimed" | "protected" | "deleting" | "missing"> {
  const db = await open(path, onContention);
  try {
    const build = db
      .prepare("SELECT retention_state FROM builds WHERE project_id = ? AND id = ?")
      .get(projectId, buildId) as unknown[] | undefined;
    const result = claim(db, projectId, buildId, build);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    rollbackQuietly(db);
    throw error;
  } finally {
    db.close();
  }
}

function claim(
  db: DatabaseSync,
  projectId: string,
  buildId: string,
  build: unknown[] | undefined,
): "claimed" | "protected" | "deleting" | "missing" {
  if (!build) return "missing";
  if (build[0] !== "available") return "deleting";
  if (db.prepare("SELECT 1 FROM build_references WHERE build_id = ? LIMIT 1").get(buildId))
    return "protected";
  db.prepare("UPDATE builds SET retention_state = 'deleting' WHERE project_id = ? AND id = ?").run(
    projectId,
    buildId,
  );
  return "claimed";
}
