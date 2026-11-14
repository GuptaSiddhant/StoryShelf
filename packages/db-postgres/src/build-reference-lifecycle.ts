/**
 * Postgres' implementation of the build retention lifecycle (ADR 0039). Where SQLite serializes
 * through its write lock, this takes row locks, always in the same order (owners by key, then
 * builds by id), so two connections cannot deadlock and each outcome is one the SQLite contract
 * allows:
 *
 * - an owner's `build_reference_generations` row is locked `FOR UPDATE`, which is the fence;
 * - each referenced build row is locked `FOR SHARE`, which conflicts with {@link claimDeletion}'s
 *   `FOR UPDATE` of the same row, so an admission and a tombstone of one build cannot both win.
 */
import {
  ReferenceGenerationConflict,
  type BuildReferenceLifecycle,
  type BuildReferenceOwner,
  type FencedBuildReferenceChange,
  type TxStore,
} from "@storyshelf/core/adapter/database";
import { sql } from "drizzle-orm";
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
import {
  inTransaction,
  valueList,
  type LifecycleDatabase,
  type LifecycleTx,
} from "./lifecycle-transaction.ts";

type Change = FencedBuildReferenceChange & { ids: string[] };

/**
 * The lifecycle over a Drizzle Postgres database (any driver); each operation opens its own
 * transaction. `database` is the driver's Drizzle instance, taken as `unknown` and cast once, as
 * `createDrizzlePgAdapter` does.
 */
export function createBuildReferenceLifecycle(database: unknown): BuildReferenceLifecycle {
  const db = database as LifecycleDatabase;
  return {
    referenceGeneration: async (owner) => await referenceGeneration(db, owner),
    replaceManyFencedReferences: async (changes, writeDomain) =>
      await replaceManyFencedReferences(db, changes, writeDomain),
    replaceFencedReferences: async (owner, generation, ids, writeDomain) => {
      const changes = [{ owner, expectedGeneration: generation, buildIds: ids }];
      const updated = await replaceManyFencedReferences(db, changes, writeDomain);
      return { result: updated.result, generation: generation + 1 };
    },
    claimDeletion: async (projectId, buildId) => await claimDeletion(db, projectId, buildId),
    listDeleting: async (projectId) => await listDeleting(db, projectId),
    releaseBuildContent: async (projectId, buildId, hashes) =>
      await releaseBuildContent(db, projectId, buildId, hashes),
    markStorageDeleted: async (projectId, buildId) =>
      await markStorageDeleted(db, projectId, buildId),
    completeDeletion: async (projectId, buildId, removeRows) =>
      await completeDeletion(db, projectId, buildId, removeRows),
    recordContentUses: async (projectId, buildId, hashes, staleBefore, sizes) =>
      await recordContentUses(db, projectId, buildId, hashes, staleBefore, sizes),
    contentUsage: async (projectId) => await contentUsage(db, projectId),
    claimContent: async (token, idleBefore, staleBefore) =>
      await claimContent(db, token, idleBefore, staleBefore),
    holdsContentClaim: async (hash, token) => await holdsContentClaim(db, hash, token),
    abandonContentClaim: async (hash, token) => {
      await abandonContentClaim(db, hash, token);
    },
    finishContentCollection: async (hash, token) => {
      await finishContentCollection(db, hash, token);
    },
  };
}

async function referenceGeneration(
  db: LifecycleDatabase,
  owner: BuildReferenceOwner,
): Promise<number> {
  return await inTransaction(db, async ({ query }) => {
    const rows = await query(sql`SELECT generation FROM build_reference_generations
      WHERE project_id = ${owner.projectId} AND owner_type = ${owner.type} AND owner_id = ${owner.id}`);
    return Number(rows[0]?.["generation"] ?? 0);
  });
}

/** Fence every owner, run the domain write, then replace the references and advance the fences. */
async function replaceManyFencedReferences<T>(
  db: LifecycleDatabase,
  changes: readonly FencedBuildReferenceChange[],
  writeDomain: (tx: TxStore) => Promise<T>,
): Promise<{ result: T; generations: number[] }> {
  validateFencedChanges(changes);
  const normalized = changes.map((change) => ({
    ...change,
    ids: [...new Set(change.buildIds)].toSorted(),
  }));
  return await inTransaction(db, async (tx) => {
    for (const change of byOwnerKey(normalized)) {
      // oxlint-disable-next-line no-await-in-loop -- locks are taken one at a time, in key order
      await fence(tx, change);
    }
    await lockAvailable(tx, normalized);
    const result = await writeDomain(tx.store);
    for (const change of normalized) {
      // oxlint-disable-next-line no-await-in-loop -- each owner's rows are replaced in turn
      await saveReferences(tx, change);
    }
    return { result, generations: normalized.map((change) => change.expectedGeneration + 1) };
  });
}

function ownerKey({ owner }: Change): string {
  return JSON.stringify([owner.projectId, owner.type, owner.id]);
}

/** The lock order: owners by key, whatever order the caller listed them in. */
function byOwnerKey(changes: readonly Change[]): Change[] {
  return changes.toSorted((left, right) => ownerKey(left).localeCompare(ownerKey(right)));
}

function validateFencedChanges(changes: readonly FencedBuildReferenceChange[]): void {
  const keys = changes.map(({ owner }) => JSON.stringify([owner.projectId, owner.type, owner.id]));
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate reference owner");
  for (const { expectedGeneration } of changes) {
    const valid = Number.isSafeInteger(expectedGeneration) && expectedGeneration >= 0;
    if (!valid || expectedGeneration >= Number.MAX_SAFE_INTEGER)
      throw new Error("Invalid reference generation");
  }
}

/** Lock the owner's generation row (creating it at zero) and reject a stale expectation. */
async function fence(tx: LifecycleTx, { owner, expectedGeneration }: Change): Promise<void> {
  await tx.query(sql`INSERT INTO build_reference_generations (project_id, owner_type, owner_id, generation)
    VALUES (${owner.projectId}, ${owner.type}, ${owner.id}, 0) ON CONFLICT DO NOTHING`);
  const rows = await tx.query(sql`SELECT generation FROM build_reference_generations
    WHERE project_id = ${owner.projectId} AND owner_type = ${owner.type} AND owner_id = ${owner.id}
    FOR UPDATE`);
  if (Number(rows[0]?.["generation"]) !== expectedGeneration)
    throw new ReferenceGenerationConflict("Stale reference generation");
}

/** Share-lock every referenced build, in id order, and require each to be `available`. */
async function lockAvailable(tx: LifecycleTx, changes: readonly Change[]): Promise<void> {
  const byProject = Map.groupBy(changes, ({ owner }) => owner.projectId);
  for (const [projectId, group] of byProject.entries()) {
    const ids = [...new Set(group.flatMap((change) => change.ids))].toSorted();
    if (ids.length === 0) continue;
    // oxlint-disable-next-line no-await-in-loop -- one project's builds at a time, in project order
    const rows = await tx.query(sql`SELECT id, retention_state FROM builds
      WHERE project_id = ${projectId} AND id IN (${valueList(ids)}) ORDER BY id FOR SHARE`);
    const available = rows.filter((row) => row["retention_state"] === "available");
    if (available.length !== ids.length) throw new Error("Referenced build is unavailable");
  }
}

async function saveReferences(tx: LifecycleTx, { owner, ids }: Change): Promise<void> {
  await tx.query(sql`DELETE FROM build_references
    WHERE project_id = ${owner.projectId} AND owner_type = ${owner.type} AND owner_id = ${owner.id}`);
  for (const id of ids) {
    // oxlint-disable-next-line no-await-in-loop -- a few rows per owner
    await tx.query(sql`INSERT INTO build_references (project_id, owner_type, owner_id, build_id)
      VALUES (${owner.projectId}, ${owner.type}, ${owner.id}, ${id})`);
  }
  await tx.query(sql`UPDATE build_reference_generations SET generation = generation + 1
    WHERE project_id = ${owner.projectId} AND owner_type = ${owner.type} AND owner_id = ${owner.id}`);
}

/** Tombstone the build under its row lock, unless a reference protects it. */
async function claimDeletion(
  db: LifecycleDatabase,
  projectId: string,
  buildId: string,
): Promise<"claimed" | "protected" | "deleting" | "missing"> {
  return await inTransaction(db, async ({ query }) => {
    const build = await query(sql`SELECT retention_state FROM builds
      WHERE project_id = ${projectId} AND id = ${buildId} FOR UPDATE`);
    if (build.length === 0) return "missing";
    if (build[0]?.["retention_state"] !== "available") return "deleting";
    const refs = await query(
      sql`SELECT 1 FROM build_references WHERE build_id = ${buildId} LIMIT 1`,
    );
    if (refs.length > 0) return "protected";
    await query(sql`UPDATE builds SET retention_state = 'deleting'
      WHERE project_id = ${projectId} AND id = ${buildId}`);
    return "claimed";
  });
}
