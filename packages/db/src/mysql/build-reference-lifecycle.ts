/**
 * MySQL's implementation of the build retention lifecycle (ADR 0039), over InnoDB row locks taken
 * in one fixed order (owners by key, then builds by id), the order Postgres uses:
 *
 * - an owner's `build_reference_generations` row is locked `FOR UPDATE`, which is the fence. It is
 *   created with `INSERT ... ON DUPLICATE KEY UPDATE`, which takes the row's exclusive lock at once:
 *   `INSERT IGNORE` would take a shared lock first, and two writers upgrading a shared lock to
 *   `FOR UPDATE` deadlock;
 * - each referenced build row is locked `FOR SHARE`, which conflicts with {@link claimDeletion}'s
 *   `FOR UPDATE` of the same row, so an admission and a tombstone of one build cannot both win.
 *
 * Every transaction runs at READ COMMITTED on a connection of its own (`lifecycle-transaction.ts`).
 */
import {
  ReferenceGenerationConflict,
  type BuildReferenceLifecycle,
  type BuildReferenceOwner,
  type FencedBuildReferenceChange,
  type TxStore,
} from "@storyshelf/core/adapter/database";
import {
  completeDeletion,
  listDeleting,
  markStorageDeleted,
  releaseBuildContent,
} from "./build-deletion-steps.ts";
import {
  abandonContentClaim,
  claimContent,
  contentUsage,
  finishContentCollection,
  holdsContentClaim,
  recordContentUses,
} from "./content-uses.ts";
import { inTransaction, type LifecyclePool, type LifecycleTx } from "./lifecycle-transaction.ts";

type Change = FencedBuildReferenceChange & { ids: string[] };

/** The lifecycle over a mysql2/promise pool; each operation borrows a connection and opens its own transaction. */
export function createBuildReferenceLifecycle(pool: LifecyclePool): BuildReferenceLifecycle {
  return {
    referenceGeneration: async (owner) => await referenceGeneration(pool, owner),
    replaceManyFencedReferences: async (changes, writeDomain) =>
      await replaceManyFencedReferences(pool, changes, writeDomain),
    replaceFencedReferences: async (owner, generation, ids, writeDomain) => {
      const changes = [{ owner, expectedGeneration: generation, buildIds: ids }];
      const updated = await replaceManyFencedReferences(pool, changes, writeDomain);
      return { result: updated.result, generation: generation + 1 };
    },
    claimDeletion: async (projectId, buildId) => await claimDeletion(pool, projectId, buildId),
    listDeleting: async (projectId) => await listDeleting(pool, projectId),
    releaseBuildContent: async (projectId, buildId, hashes) =>
      await releaseBuildContent(pool, projectId, buildId, hashes),
    markStorageDeleted: async (projectId, buildId) =>
      await markStorageDeleted(pool, projectId, buildId),
    completeDeletion: async (projectId, buildId, removeRows) =>
      await completeDeletion(pool, projectId, buildId, removeRows),
    recordContentUses: async (projectId, buildId, hashes, staleBefore, sizes) =>
      await recordContentUses(pool, projectId, buildId, hashes, staleBefore, sizes),
    contentUsage: async (projectId) => await contentUsage(pool, projectId),
    claimContent: async (token, idleBefore, staleBefore) =>
      await claimContent(pool, token, idleBefore, staleBefore),
    holdsContentClaim: async (hash, token) => await holdsContentClaim(pool, hash, token),
    abandonContentClaim: async (hash, token) => {
      await abandonContentClaim(pool, hash, token);
    },
    finishContentCollection: async (hash, token) => {
      await finishContentCollection(pool, hash, token);
    },
  };
}

const OWNER = "project_id = ? AND owner_type = ? AND owner_id = ?";

function ownerParams(owner: BuildReferenceOwner): string[] {
  return [owner.projectId, owner.type, owner.id];
}

async function referenceGeneration(
  pool: LifecyclePool,
  owner: BuildReferenceOwner,
): Promise<number> {
  return await inTransaction(pool, async ({ query }) => {
    const rows = await query(
      `SELECT generation FROM build_reference_generations WHERE ${OWNER}`,
      ownerParams(owner),
    );
    return Number(rows[0]?.["generation"] ?? 0);
  });
}

/**
 * Fence every owner, run the domain write, then replace the references and advance the fences. The
 * domain write is the caller's: a deadlock is not retried here (it reaches the caller, with every
 * write of the transaction rolled back).
 */
async function replaceManyFencedReferences<T>(
  pool: LifecyclePool,
  changes: readonly FencedBuildReferenceChange[],
  writeDomain: (tx: TxStore) => Promise<T>,
): Promise<{ result: T; generations: number[] }> {
  validateFencedChanges(changes);
  const normalized = changes.map((change) => ({
    ...change,
    ids: [...new Set(change.buildIds)].toSorted(),
  }));
  return await inTransaction(
    pool,
    async (tx) => {
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
    },
    false,
  );
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

/**
 * Create the owner's generation row at zero if needed and hold its exclusive lock: the fence every
 * writer, and preparation, takes first.
 */
export async function lockFence(tx: LifecycleTx, owner: BuildReferenceOwner): Promise<number> {
  await tx.run(
    `INSERT INTO build_reference_generations (project_id, owner_type, owner_id, generation)
      VALUES (?, ?, ?, 0) ON DUPLICATE KEY UPDATE generation = generation`,
    ownerParams(owner),
  );
  const rows = await tx.query(
    `SELECT generation FROM build_reference_generations WHERE ${OWNER} FOR UPDATE`,
    ownerParams(owner),
  );
  return Number(rows[0]?.["generation"]);
}

/** Every reference mutation advances the owner's fence. */
export async function advance(tx: LifecycleTx, owner: BuildReferenceOwner): Promise<void> {
  await tx.run(
    `UPDATE build_reference_generations SET generation = generation + 1 WHERE ${OWNER}`,
    ownerParams(owner),
  );
}

/** Lock the owner's fence and reject a stale expectation. */
async function fence(tx: LifecycleTx, { owner, expectedGeneration }: Change): Promise<void> {
  if ((await lockFence(tx, owner)) !== expectedGeneration)
    throw new ReferenceGenerationConflict("Stale reference generation");
}

/** Share-lock every referenced build, in id order, and require each to be `available`. */
async function lockAvailable(tx: LifecycleTx, changes: readonly Change[]): Promise<void> {
  const byProject = Map.groupBy(changes, ({ owner }) => owner.projectId);
  const projects = [...byProject.keys()].toSorted();
  for (const projectId of projects) {
    const ids = [...new Set((byProject.get(projectId) ?? []).flatMap((change) => change.ids))];
    if (ids.length === 0) continue;
    // oxlint-disable-next-line no-await-in-loop -- one project's builds at a time, in project order
    const rows = await tx.query(
      `SELECT id, retention_state FROM builds
        WHERE project_id = ? AND id IN (?) ORDER BY id FOR SHARE`,
      [projectId, ids.toSorted()],
    );
    const available = rows.filter((row) => row["retention_state"] === "available");
    if (available.length !== ids.length) throw new Error("Referenced build is unavailable");
  }
}

async function saveReferences(tx: LifecycleTx, { owner, ids }: Change): Promise<void> {
  await tx.run(`DELETE FROM build_references WHERE ${OWNER}`, ownerParams(owner));
  if (ids.length > 0) {
    await tx.run(
      "INSERT INTO build_references (project_id, owner_type, owner_id, build_id) VALUES ?",
      [ids.map((id) => [...ownerParams(owner), id])],
    );
  }
  await advance(tx, owner);
}

/** Tombstone the build under its row lock, unless a reference protects it. */
async function claimDeletion(
  pool: LifecyclePool,
  projectId: string,
  buildId: string,
): Promise<"claimed" | "protected" | "deleting" | "missing"> {
  return await inTransaction(pool, async ({ query, run }) => {
    const build = await query(
      "SELECT retention_state FROM builds WHERE project_id = ? AND id = ? FOR UPDATE",
      [projectId, buildId],
    );
    if (build.length === 0) return "missing";
    if (build[0]?.["retention_state"] !== "available") return "deleting";
    const refs = await query("SELECT 1 FROM build_references WHERE build_id = ? LIMIT 1", [
      buildId,
    ]);
    if (refs.length > 0) return "protected";
    await run("UPDATE builds SET retention_state = 'deleting' WHERE project_id = ? AND id = ?", [
      projectId,
      buildId,
    ]);
    return "claimed";
  });
}
