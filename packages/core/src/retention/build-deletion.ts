/**
 * Finish the deletion of a build the lifecycle capability has claimed (ADR 0039 decision 2).
 *
 * Three idempotent steps, each recorded durably, so a crash anywhere resumes at the first
 * unfinished one: release the build's shared content exactly once, delete its storage objects
 * outside any database transaction, then remove its rows in one transaction. The tombstone never
 * expires; only the cleaner running this may disappear.
 */
import { eq } from "drizzle-orm";
import type { Table } from "drizzle-orm";
import type {
  BuildReferenceLifecycle,
  DatabaseAdapter,
  DeletingBuild,
  Tables,
  TxStore,
} from "../adapters/database.ts";
import type { StorageAdapter } from "../adapters/storage.ts";
import type { Logger } from "../logger.ts";
import { col } from "../models/columns.ts";

/** The recorded steps of a deletion, in order. */
export type DeletionStep = "content" | "storage" | "rows";

/** What a cleaner needs; `afterStep` is a test seam (a throw there stands for a crash). */
export interface BuildDeletionDeps {
  db: Pick<DatabaseAdapter, "tables">;
  lifecycle: BuildReferenceLifecycle;
  storage: StorageAdapter;
  logger?: Logger;
  afterStep?: (step: DeletionStep, buildId: string) => Promise<void> | void;
}

/** How one build's cleanup ended: finished by this run, or already finished by another. */
export interface BuildDeletionResult {
  buildId: string;
  outcome: "deleted" | "already-gone";
  /** Storage objects this run deleted. */
  files: number;
}

/** Run the unfinished steps of `build`; a build another cleaner finished meanwhile is `already-gone`. */
export async function deleteClaimedBuild(
  deps: BuildDeletionDeps,
  build: DeletingBuild,
): Promise<BuildDeletionResult> {
  const { projectId, buildId } = build;
  if (!build.contentReleased && !(await releaseContent(deps, projectId, buildId))) {
    return { buildId, outcome: "already-gone", files: 0 };
  }
  let files = 0;
  if (!build.storageDeleted) {
    const stored = await deleteStorage(deps, projectId, buildId);
    if (stored === null) return { buildId, outcome: "already-gone", files: 0 };
    files = stored;
  }
  const done = await removeRows(deps, projectId, buildId);
  return { buildId, outcome: done ? "deleted" : "already-gone", files };
}

/** Step 1. False when the build is no longer `deleting`. */
async function releaseContent(
  deps: BuildDeletionDeps,
  projectId: string,
  buildId: string,
): Promise<boolean> {
  const hashes = await manifestHashes(deps, projectId, buildId);
  const result = await deps.lifecycle.releaseBuildContent(projectId, buildId, hashes);
  if (result === "not-deleting") return false;
  await deps.afterStep?.("content", buildId);
  return true;
}

/** Step 2. The number of files deleted, or null when the build is no longer `deleting`. */
async function deleteStorage(
  deps: BuildDeletionDeps,
  projectId: string,
  buildId: string,
): Promise<number | null> {
  const files = await deps.storage.list(buildPrefix(projectId, buildId));
  await Promise.all(
    files.map(async (file) => {
      await deleteFile(deps.storage, file);
    }),
  );
  const result = await deps.lifecycle.markStorageDeleted(projectId, buildId);
  if (result === "not-deleting") return null;
  if (result === "out-of-order") throw new Error(`Build ${buildId} deleted storage before content`);
  await deps.afterStep?.("storage", buildId);
  return files.length;
}

/** Step 3. False when the build was already removed. */
async function removeRows(
  deps: BuildDeletionDeps,
  projectId: string,
  buildId: string,
): Promise<boolean> {
  const tables = deps.db.tables;
  const done = await deps.lifecycle.completeDeletion(projectId, buildId, async (tx) => {
    await removeBuildRows(tx, tables, buildId);
  });
  if (done === "not-deleting") return false;
  if (done === "out-of-order") throw new Error(`Build ${buildId} removed rows before storage`);
  await deps.afterStep?.("rows", buildId);
  return true;
}

/** The build's rows without a foreign key, then the build (the rest cascade with it). */
async function removeBuildRows(tx: TxStore, tables: Tables, buildId: string): Promise<void> {
  for (const table of [tables.insights, tables.captureJobs, tables.buildComponents]) {
    // oxlint-disable-next-line no-await-in-loop -- one table at a time inside the transaction
    await removeByBuild(tx, table, buildId);
  }
  await removeByBuild(tx, tables.buildPackageUsage, buildId);
  await tx.remove(tables.builds, buildId);
}

async function removeByBuild(tx: TxStore, table: Table, buildId: string): Promise<void> {
  const rows = (await tx.list(table, {
    where: eq(col(table, "buildId"), buildId),
  })) as unknown as { id: string }[];
  for (const row of rows) {
    // oxlint-disable-next-line no-await-in-loop -- sequential removes keep the transaction simple
    await tx.remove(table, row.id);
  }
}

/** Where a build's own storage objects live. */
export function buildPrefix(projectId: string, buildId: string): string {
  return `${projectId}/builds/${buildId}/`;
}

/**
 * The distinct content hashes the build's manifest names. No manifest means no shared content. A
 * manifest that exists but cannot be read throws, so the step is retried; one that cannot be
 * parsed is skipped with a warning (its counts then stay, which keeps the content, never loses it).
 */
export async function manifestHashes(
  deps: Pick<BuildDeletionDeps, "storage" | "logger">,
  projectId: string,
  buildId: string,
): Promise<string[]> {
  const path = `${buildPrefix(projectId, buildId)}storybook/manifest.json`;
  if (!(await deps.storage.exists(path))) return [];
  const raw = await deps.storage.read(path);
  try {
    const manifest = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const hashes = Object.values(manifest).filter(
      (hash): hash is string => typeof hash === "string",
    );
    return [...new Set(hashes)];
  } catch (error) {
    deps.logger?.warn({ err: error, buildId }, "build manifest unreadable; content counts kept");
    return [];
  }
}

/** Delete one file; a file another cleaner already deleted is not an error. */
async function deleteFile(storage: StorageAdapter, file: string): Promise<void> {
  try {
    await storage.delete(file);
  } catch (error) {
    if (await storage.exists(file)) throw error;
  }
}
