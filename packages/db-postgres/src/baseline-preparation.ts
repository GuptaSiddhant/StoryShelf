/**
 * Baseline preparation for Postgres (ADR 0039, "activation"): before an adapter exposes
 * `buildReferenceLifecycle`, every baseline that records a source or a snapshot has its proven
 * source build pinned, and pins that no baseline can justify are released. SQLite does this under
 * its write lock; here one transaction takes the same row locks as the fenced writers, in the same
 * order (owners by key, then builds), so preparation can run beside live traffic and beside another
 * instance that is booting: the second waits on the first's locks and finds nothing left to change.
 *
 * A recorded source that is tombstoned or belongs to another project stops the whole run with a
 * {@link BaselineSourceIntegrityError}; the transaction rolls back and nothing is cleared or guessed.
 */
import {
  BaselineSourceIntegrityError,
  type BuildReferenceOwner,
} from "@storyshelf/core/adapter/database";
import { resolveBaselineOrigin } from "@storyshelf/core/models";
import type { Baseline, Build, Snapshot } from "@storyshelf/core/schema";
import { sql } from "drizzle-orm";
import {
  inTransaction,
  type LifecycleDatabase,
  type LifecycleTx,
} from "./lifecycle-transaction.ts";
import { schema } from "./schema/index.ts";

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

/** A baseline owner to visit: it records provenance, or a pin still names it. */
interface Candidate {
  projectId: string;
  id: string;
}

/**
 * Prepare the baseline pins in one transaction. `beforeCommit` runs after the last baseline and
 * before the commit, so a test can fail the run at the point where everything is written.
 */
export async function prepareBaselineReferences(
  database: unknown,
  beforeCommit?: () => Promise<void>,
): Promise<PreparationResult> {
  const db = database as LifecycleDatabase;
  return await inTransaction(db, async (tx) => {
    const outcomes: Prepared[] = [];
    for (const candidate of await candidates(tx)) {
      // oxlint-disable-next-line no-await-in-loop -- one owner at a time, in lock order: a failure must stop the rest before the rollback
      const outcome = await prepareOwner(tx, candidate);
      if (outcome) outcomes.push(outcome);
    }
    await beforeCommit?.();
    return tally(outcomes);
  });
}

/** Baselines with provenance plus owners that hold a baseline pin, sorted like the fenced writers lock. */
async function candidates(tx: LifecycleTx): Promise<Candidate[]> {
  const rows = await tx.query(sql`SELECT project_id, id FROM baselines
    WHERE source_build_id IS NOT NULL OR snapshot_id IS NOT NULL
    UNION SELECT project_id, owner_id AS id FROM build_references WHERE owner_type = 'baseline'`);
  return rows
    .map((row) => ({ projectId: String(row["project_id"]), id: String(row["id"]) }))
    .toSorted((left, right) => lockKey(left).localeCompare(lockKey(right)));
}

/** The order `replaceManyFencedReferences` locks owners in. */
function lockKey({ projectId, id }: Candidate): string {
  return JSON.stringify([projectId, "baseline", id]);
}

function tally(outcomes: readonly Prepared[]): PreparationResult {
  const count = (kind: Prepared): number => outcomes.filter((outcome) => outcome === kind).length;
  return {
    protected: count("protected"),
    unknown: count("unknown"),
    unavailable: count("unavailable"),
  };
}

/** Lock the owner's fence, then prepare its baseline; an owner without provenance loses its pins. */
async function prepareOwner(tx: LifecycleTx, candidate: Candidate): Promise<Prepared | null> {
  await lockFence(tx, { type: "baseline", ...candidate });
  const baseline = (await tx.store.get(schema.baselines, candidate.id)) as Baseline | null;
  if (baseline && (baseline.sourceBuildId || baseline.snapshotId)) {
    return await prepareBaseline(tx, baseline);
  }
  // The baseline is gone or records neither a source nor a snapshot: the unfenced path (retention
  // off or not yet existing) could clear it or delete it without releasing its pin.
  if (await releasePins(tx, { type: "baseline", ...candidate }))
    await advance(tx, ownerOf(candidate));
  return null;
}

function ownerOf({ projectId, id }: Candidate): BuildReferenceOwner {
  return { projectId, type: "baseline", id };
}

/** Create the owner's generation row at zero if needed and lock it: the fence every writer takes first. */
async function lockFence(tx: LifecycleTx, owner: BuildReferenceOwner): Promise<void> {
  await tx.query(sql`INSERT INTO build_reference_generations (project_id, owner_type, owner_id, generation)
    VALUES (${owner.projectId}, ${owner.type}, ${owner.id}, 0) ON CONFLICT DO NOTHING`);
  await tx.query(sql`SELECT generation FROM build_reference_generations
    WHERE project_id = ${owner.projectId} AND owner_type = ${owner.type} AND owner_id = ${owner.id}
    FOR UPDATE`);
}

/** Every reference mutation advances the owner's fence. */
async function advance(tx: LifecycleTx, owner: BuildReferenceOwner): Promise<void> {
  await tx.query(sql`UPDATE build_reference_generations SET generation = generation + 1
    WHERE project_id = ${owner.projectId} AND owner_type = ${owner.type} AND owner_id = ${owner.id}`);
}

/** Drop every pin the owner holds; true when there was one. The caller advances the generation. */
async function releasePins(tx: LifecycleTx, owner: BuildReferenceOwner): Promise<boolean> {
  const removed = await tx.query(sql`DELETE FROM build_references
    WHERE project_id = ${owner.projectId} AND owner_type = ${owner.type} AND owner_id = ${owner.id}
    RETURNING 1 AS removed`);
  return removed.length > 0;
}

async function prepareBaseline(tx: LifecycleTx, baseline: Baseline): Promise<Prepared> {
  if (
    baseline.sourceBuildId &&
    !(await recordedSourcePresent(tx, baseline, baseline.sourceBuildId))
  ) {
    // The record stays (it is verified history), but nothing may pin a build for it.
    if (await releasePins(tx, ownerOf(baseline))) await advance(tx, ownerOf(baseline));
    return "unavailable";
  }
  const source = await provenSource(tx, baseline);
  if (!source) {
    await setPreparedSource(tx, baseline, null);
    return "unknown";
  }
  await pinAvailableSource(tx, baseline, source.id);
  await setPreparedSource(tx, baseline, source.id);
  return "protected";
}

/** The build that provably rendered the baseline's image, or null when its history is incomplete. */
async function provenSource(tx: LifecycleTx, baseline: Baseline): Promise<Build | null> {
  return await resolveBaselineOrigin(baseline, {
    baseline: async (key) => (await tx.store.get(schema.baselines, key)) as Baseline | null,
    snapshot: async (key) => (await tx.store.get(schema.snapshots, key)) as Snapshot | null,
    build: async (key) => (await tx.store.get(schema.builds, key)) as Build | null,
  });
}

/**
 * Whether the build a baseline records as its source still has a row. A row in another project is
 * an integrity problem, not a missing build: the record is neither kept nor cleared.
 */
async function recordedSourcePresent(
  tx: LifecycleTx,
  baseline: Baseline,
  buildId: string,
): Promise<boolean> {
  const rows = await tx.query(sql`SELECT project_id FROM builds WHERE id = ${buildId}`);
  if (rows.length === 0) return false;
  if (rows[0]?.["project_id"] !== baseline.projectId) {
    throw new BaselineSourceIntegrityError(baseline.id, buildId, "other-project");
  }
  return true;
}

async function setPreparedSource(
  tx: LifecycleTx,
  baseline: Baseline,
  source: string | null,
): Promise<void> {
  const removed = source === null && (await releasePins(tx, ownerOf(baseline)));
  if ((baseline.sourceBuildId ?? null) === source && !removed) return;
  await tx.query(sql`UPDATE baselines SET source_build_id = ${source} WHERE id = ${baseline.id}`);
  await advance(tx, ownerOf(baseline));
}

/**
 * Pin `buildId` for the baseline, replacing a pin on any other build. The build row is share-locked,
 * which conflicts with a deletion claim's `FOR UPDATE`, so a tombstone cannot slip in after the
 * check; a tombstoned build is never pinned.
 */
async function pinAvailableSource(
  tx: LifecycleTx,
  baseline: Baseline,
  buildId: string,
): Promise<void> {
  const { id, projectId } = baseline;
  const rows = await tx.query(sql`SELECT retention_state FROM builds
    WHERE id = ${buildId} AND project_id = ${projectId} FOR SHARE`);
  if (rows[0]?.["retention_state"] !== "available") {
    throw new BaselineSourceIntegrityError(id, buildId, "tombstoned");
  }
  const removed = await tx.query(sql`DELETE FROM build_references
    WHERE project_id = ${projectId} AND owner_type = 'baseline' AND owner_id = ${id}
      AND build_id <> ${buildId} RETURNING 1 AS removed`);
  const added =
    await tx.query(sql`INSERT INTO build_references (project_id, owner_type, owner_id, build_id)
    VALUES (${projectId}, 'baseline', ${id}, ${buildId}) ON CONFLICT DO NOTHING RETURNING 1 AS added`);
  if (added.length > 0 || removed.length > 0) await advance(tx, ownerOf(baseline));
}
