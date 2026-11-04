/** Durable progress of a claimed build's cleanup (ADR 0039 decision 2), in SQLite's write lock. */
import type { DeletingBuild, DeletionStepResult, TxStore } from "@storyshelf/core/adapter/database";
import type { DatabaseSync } from "node:sqlite";
import { inTransaction, transactionStore } from "./lifecycle-transaction.ts";

/** What `deletionState` reads: the tombstone and the recorded steps. */
interface State {
  contentReleased: boolean;
  storageDeleted: boolean;
}

/** Builds of the project that are `deleting`, in the order they were claimed. */
export async function listDeleting(path: string, projectId: string): Promise<DeletingBuild[]> {
  return await inTransaction(path, async (db) => {
    const rows = db
      .prepare(
        `SELECT b.id, d.content_released_at, d.storage_deleted_at
         FROM builds b LEFT JOIN build_deletions d ON d.build_id = b.id
         WHERE b.project_id = ? AND b.retention_state = 'deleting'
         ORDER BY COALESCE(d.created_at, b.updated_at), b.id`,
      )
      .all(projectId) as unknown as [string, string | null, string | null][];
    return await Promise.resolve(
      rows.map(([buildId, released, deleted]) => ({
        projectId,
        buildId,
        contentReleased: released !== null,
        storageDeleted: deleted !== null,
      })),
    );
  });
}

/** Release each distinct hash once and mark the step, or report why it did not apply. */
export async function releaseBuildContent(
  path: string,
  projectId: string,
  buildId: string,
  hashes: readonly string[],
): Promise<DeletionStepResult> {
  return await inTransaction(path, async (db) => {
    const state = deletionState(db, projectId, buildId);
    if (state === null) return "not-deleting";
    if (state.contentReleased) return "already-done";
    const now = new Date().toISOString();
    ensureRecord(db, projectId, buildId, now);
    for (const hash of new Set(hashes)) releaseOnce(db, buildId, hash, now);
    db.prepare(
      "UPDATE build_deletions SET content_released_at = ?, updated_at = ? WHERE build_id = ?",
    ).run(now, now, buildId);
    return await Promise.resolve("done" as const);
  });
}

/** Record that storage is deleted; the build must have released its content first. */
export async function markStorageDeleted(
  path: string,
  projectId: string,
  buildId: string,
): Promise<DeletionStepResult> {
  return await inTransaction(path, async (db) => {
    const state = deletionState(db, projectId, buildId);
    if (state === null) return "not-deleting";
    if (!state.contentReleased) return "out-of-order";
    if (state.storageDeleted) return "already-done";
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE build_deletions SET storage_deleted_at = ?, updated_at = ? WHERE build_id = ?",
    ).run(now, now, buildId);
    return await Promise.resolve("done" as const);
  });
}

/** Remove the build's rows and its progress records in one transaction. */
export async function completeDeletion<T>(
  path: string,
  projectId: string,
  buildId: string,
  removeRows: (tx: TxStore) => Promise<T>,
): Promise<{ result: T } | "not-deleting" | "out-of-order"> {
  return await inTransaction(path, async (db) => {
    const state = deletionState(db, projectId, buildId);
    if (state === null) return "not-deleting";
    if (!state.storageDeleted) return "out-of-order";
    // The progress rows go with the build (ON DELETE CASCADE); a write that leaves it keeps them.
    return { result: await removeRows(transactionStore(db)) };
  });
}

/** The recorded steps of a `deleting` build of the project, or null when it is not one. */
function deletionState(db: DatabaseSync, projectId: string, buildId: string): State | null {
  const row = db
    .prepare(
      `SELECT b.retention_state, d.content_released_at, d.storage_deleted_at
       FROM builds b LEFT JOIN build_deletions d ON d.build_id = b.id
       WHERE b.project_id = ? AND b.id = ?`,
    )
    .get(projectId, buildId) as unknown as [string, string | null, string | null] | undefined;
  if (row?.[0] !== "deleting") return null;
  return { contentReleased: row[1] !== null, storageDeleted: row[2] !== null };
}

function ensureRecord(db: DatabaseSync, projectId: string, buildId: string, now: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO build_deletions (build_id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
  ).run(buildId, projectId, now, now);
}

/** Insert the release record, and decrement the count only if the record was new. */
function releaseOnce(db: DatabaseSync, buildId: string, hash: string, now: string): void {
  const inserted = db
    .prepare(
      "INSERT OR IGNORE INTO build_content_releases (build_id, content_hash, released_at) VALUES (?, ?, ?)",
    )
    .run(buildId, hash, now);
  if (inserted.changes === 0) return;
  // Keep the row at zero for the grace period (ADR 0003); never go negative.
  db.prepare(
    "UPDATE content_refs SET ref_count = MAX(ref_count - 1, 0), last_seen_at = ? WHERE hash = ?",
  ).run(now, hash);
}
