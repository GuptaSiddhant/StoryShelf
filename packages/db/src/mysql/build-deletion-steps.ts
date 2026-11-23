/** Durable progress of a claimed build's cleanup (ADR 0039 decision 2), under the build's row lock. */
import type { DeletingBuild, DeletionStepResult, TxStore } from "@storyshelf/core/adapter/database";
import {
  chunks,
  inTransaction,
  nowInstant,
  type LifecyclePool,
  type LifecycleTx,
} from "./lifecycle-transaction.ts";

/** What {@link deletionState} reads: the tombstone and the recorded steps. */
interface State {
  contentReleased: boolean;
  storageDeleted: boolean;
}

function recorded(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** Builds of the project that are `deleting`, in the order they were claimed. */
export async function listDeleting(
  pool: LifecyclePool,
  projectId: string,
): Promise<DeletingBuild[]> {
  return await inTransaction(pool, async ({ query }) => {
    const rows = await query(
      `SELECT b.id, d.content_released_at, d.storage_deleted_at
        FROM builds b LEFT JOIN build_deletions d ON d.build_id = b.id
        WHERE b.project_id = ? AND b.retention_state = 'deleting'
        ORDER BY COALESCE(d.created_at, b.updated_at), b.id`,
      [projectId],
    );
    return rows.map((row) => ({
      projectId,
      buildId: String(row["id"]),
      contentReleased: recorded(row["content_released_at"]),
      storageDeleted: recorded(row["storage_deleted_at"]),
    }));
  });
}

/** Release each distinct hash once and mark the step, or report why it did not apply. */
export async function releaseBuildContent(
  pool: LifecyclePool,
  projectId: string,
  buildId: string,
  hashes: readonly string[],
): Promise<DeletionStepResult> {
  return await inTransaction(pool, async (tx) => {
    const state = await deletionState(tx, projectId, buildId);
    if (state === null) return "not-deleting";
    if (state.contentReleased) return "already-done";
    const now = nowInstant();
    await tx.run(
      `INSERT INTO build_deletions (build_id, project_id, created_at, updated_at)
        VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE build_id = build_id`,
      [buildId, projectId, now, now],
    );
    for (const slice of chunks([...new Set(hashes)])) {
      // oxlint-disable-next-line no-await-in-loop -- bounded statements, in order
      await tx.run(
        `INSERT INTO build_content_releases (build_id, content_hash, released_at) VALUES ?
          ON DUPLICATE KEY UPDATE released_at = released_at`,
        [slice.map((hash) => [buildId, hash, now])],
      );
    }
    // Every use the build holds, whatever its manifest lists; the blob stays for the grace period.
    await tx.run(
      "UPDATE content_uses SET released_at = ? WHERE build_id = ? AND released_at IS NULL",
      [now, buildId],
    );
    await tx.run(
      "UPDATE build_deletions SET content_released_at = ?, updated_at = ? WHERE build_id = ?",
      [now, now, buildId],
    );
    return "done";
  });
}

/** Record that storage is deleted; the build must have released its content first. */
export async function markStorageDeleted(
  pool: LifecyclePool,
  projectId: string,
  buildId: string,
): Promise<DeletionStepResult> {
  return await inTransaction(pool, async (tx) => {
    const state = await deletionState(tx, projectId, buildId);
    if (state === null) return "not-deleting";
    if (!state.contentReleased) return "out-of-order";
    if (state.storageDeleted) return "already-done";
    const now = nowInstant();
    await tx.run(
      "UPDATE build_deletions SET storage_deleted_at = ?, updated_at = ? WHERE build_id = ?",
      [now, now, buildId],
    );
    return "done";
  });
}

/**
 * Remove the build's rows and its progress records in one transaction. `removeRows` is the caller's
 * callback, so a deadlock is not retried here: it reaches the caller with everything rolled back.
 */
export async function completeDeletion<T>(
  pool: LifecyclePool,
  projectId: string,
  buildId: string,
  removeRows: (tx: TxStore) => Promise<T>,
): Promise<{ result: T } | "not-deleting" | "out-of-order"> {
  return await inTransaction(
    pool,
    async (tx) => {
      const state = await deletionState(tx, projectId, buildId);
      if (state === null) return "not-deleting";
      if (!state.storageDeleted) return "out-of-order";
      // The progress rows go with the build (ON DELETE CASCADE); a write that leaves it keeps them.
      return { result: await removeRows(tx.store) };
    },
    false,
  );
}

/**
 * The recorded steps of a `deleting` build of the project, or null when it is not one. The build
 * row stays locked until the transaction ends, so two cleaners take their steps one after another.
 *
 * Two statements, never one join locking only the build: the unlocked side of such a join is read
 * from the statement's start, before the wait for the lock, and would miss the steps the previous
 * holder committed. Read after the lock, at READ COMMITTED, the steps are current.
 */
async function deletionState(
  tx: LifecycleTx,
  projectId: string,
  buildId: string,
): Promise<State | null> {
  const build = await tx.query(
    "SELECT retention_state FROM builds WHERE project_id = ? AND id = ? FOR UPDATE",
    [projectId, buildId],
  );
  if (build[0]?.["retention_state"] !== "deleting") return null;
  const steps = await tx.query(
    "SELECT content_released_at, storage_deleted_at FROM build_deletions WHERE build_id = ?",
    [buildId],
  );
  return {
    contentReleased: recorded(steps[0]?.["content_released_at"]),
    storageDeleted: recorded(steps[0]?.["storage_deleted_at"]),
  };
}
