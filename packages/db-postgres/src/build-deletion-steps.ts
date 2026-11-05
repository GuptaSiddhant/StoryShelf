/** Durable progress of a claimed build's cleanup (ADR 0039 decision 2), under the build's row lock. */
import type { DeletingBuild, DeletionStepResult, TxStore } from "@storyshelf/core/adapter/database";
import { sql } from "drizzle-orm";
import {
  inTransaction,
  isoOf,
  type LifecycleDatabase,
  type LifecycleTx,
} from "./lifecycle-transaction.ts";

/** What {@link deletionState} reads: the tombstone and the recorded steps. */
interface State {
  contentReleased: boolean;
  storageDeleted: boolean;
}

/** Builds of the project that are `deleting`, in the order they were claimed. */
export async function listDeleting(
  db: LifecycleDatabase,
  projectId: string,
): Promise<DeletingBuild[]> {
  return await inTransaction(db, async ({ query }) => {
    const rows = await query(sql`SELECT b.id, d.content_released_at, d.storage_deleted_at
      FROM builds b LEFT JOIN build_deletions d ON d.build_id = b.id
      WHERE b.project_id = ${projectId} AND b.retention_state = 'deleting'
      ORDER BY COALESCE(d.created_at, b.updated_at), b.id`);
    return rows.map((row) => ({
      projectId,
      buildId: String(row["id"]),
      contentReleased: isoOf(row["content_released_at"]) !== null,
      storageDeleted: isoOf(row["storage_deleted_at"]) !== null,
    }));
  });
}

/** Release each distinct hash once and mark the step, or report why it did not apply. */
export async function releaseBuildContent(
  db: LifecycleDatabase,
  projectId: string,
  buildId: string,
  hashes: readonly string[],
): Promise<DeletionStepResult> {
  return await inTransaction(db, async (tx) => {
    const state = await deletionState(tx, projectId, buildId);
    if (state === null) return "not-deleting";
    if (state.contentReleased) return "already-done";
    const now = new Date().toISOString();
    await tx.query(sql`INSERT INTO build_deletions (build_id, project_id, created_at, updated_at)
      VALUES (${buildId}, ${projectId}, ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT DO NOTHING`);
    for (const hash of new Set(hashes)) {
      // oxlint-disable-next-line no-await-in-loop -- one release record per hash
      await tx.query(sql`INSERT INTO build_content_releases (build_id, content_hash, released_at)
        VALUES (${buildId}, ${hash}, ${now}::timestamptz) ON CONFLICT DO NOTHING`);
    }
    // Every use the build holds, whatever its manifest lists; the blob stays for the grace period.
    await tx.query(sql`UPDATE content_uses SET released_at = ${now}::timestamptz
      WHERE build_id = ${buildId} AND released_at IS NULL`);
    await tx.query(sql`UPDATE build_deletions
      SET content_released_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
      WHERE build_id = ${buildId}`);
    return "done";
  });
}

/** Record that storage is deleted; the build must have released its content first. */
export async function markStorageDeleted(
  db: LifecycleDatabase,
  projectId: string,
  buildId: string,
): Promise<DeletionStepResult> {
  return await inTransaction(db, async (tx) => {
    const state = await deletionState(tx, projectId, buildId);
    if (state === null) return "not-deleting";
    if (!state.contentReleased) return "out-of-order";
    if (state.storageDeleted) return "already-done";
    const now = new Date().toISOString();
    await tx.query(sql`UPDATE build_deletions
      SET storage_deleted_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
      WHERE build_id = ${buildId}`);
    return "done";
  });
}

/** Remove the build's rows and its progress records in one transaction. */
export async function completeDeletion<T>(
  db: LifecycleDatabase,
  projectId: string,
  buildId: string,
  removeRows: (tx: TxStore) => Promise<T>,
): Promise<{ result: T } | "not-deleting" | "out-of-order"> {
  return await inTransaction(db, async (tx) => {
    const state = await deletionState(tx, projectId, buildId);
    if (state === null) return "not-deleting";
    if (!state.storageDeleted) return "out-of-order";
    // The progress rows go with the build (ON DELETE CASCADE); a write that leaves it keeps them.
    return { result: await removeRows(tx.store) };
  });
}

/**
 * The recorded steps of a `deleting` build of the project, or null when it is not one. The build
 * row stays locked until the transaction ends, so two cleaners take their steps one after another.
 */
async function deletionState(
  tx: LifecycleTx,
  projectId: string,
  buildId: string,
): Promise<State | null> {
  const rows =
    await tx.query(sql`SELECT b.retention_state, d.content_released_at, d.storage_deleted_at
    FROM builds b LEFT JOIN build_deletions d ON d.build_id = b.id
    WHERE b.project_id = ${projectId} AND b.id = ${buildId} FOR UPDATE OF b`);
  const row = rows[0];
  if (row?.["retention_state"] !== "deleting") return null;
  return {
    contentReleased: isoOf(row["content_released_at"]) !== null,
    storageDeleted: isoOf(row["storage_deleted_at"]) !== null,
  };
}
