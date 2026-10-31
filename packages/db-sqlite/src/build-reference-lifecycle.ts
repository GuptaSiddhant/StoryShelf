/** SQLite's write-serialized admission and irreversible deletion claim primitive. */
import type {
  BuildReferenceChange,
  BuildReferenceLifecycle,
  BuildReferenceOwner,
  FencedBuildReferenceChange,
  TxStore,
} from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { createDrizzleAdapter } from "./drizzle-factory.ts";
import { createCallback } from "./index.ts";
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
    replaceReferences: async (owner, buildIds, writeDomain) =>
      await replaceManyReferences(path, [{ owner, buildIds }], writeDomain),
    replaceManyReferences: async (changes, writeDomain) =>
      await replaceManyReferences(path, changes, writeDomain),
    claimDeletion: async (projectId, buildId) =>
      await claimDeletion(path, projectId, buildId, onContention),
  };
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
      throw new Error("Stale reference generation");
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

async function open(path: string, onContention?: () => void): Promise<DatabaseSync> {
  if (path === ":memory:") throw new Error("Reference lifecycle requires a shared SQLite file");
  const db = new DatabaseSync(path, { returnArrays: true });
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0");
    await acquireWrite(db, onContention);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Avoid blocking this process's event loop while a different connection holds the write lock. */
async function acquireWrite(db: DatabaseSync, onContention?: () => void): Promise<void> {
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      db.exec("BEGIN IMMEDIATE");
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("database is locked") ||
        Date.now() >= deadline
      )
        throw error;
      onContention?.();
      // oxlint-disable-next-line eslint/no-await-in-loop -- wait for a competing writer to finish
      await delay(10);
    }
  }
}

function transactionStore(db: DatabaseSync): TxStore {
  return createDrizzleAdapter(drizzle(createCallback(db), { schema }), {
    metadata: {
      name: "SQLite lifecycle transaction",
      version: "0",
      kind: "sqlite",
      category: "database",
    },
    tables: schema,
    migrate: () => {},
    close: () => {},
  });
}

async function replaceManyReferences<T>(
  path: string,
  changes: readonly BuildReferenceChange[],
  writeDomain: (tx: TxStore) => Promise<T>,
): Promise<T> {
  const owners = changes.map((change) =>
    JSON.stringify([change.owner.projectId, change.owner.type, change.owner.id]),
  );
  if (new Set(owners).size !== owners.length) throw new Error("Duplicate reference owner");
  return await inTransaction(path, async (db) => {
    const normalized = changes.map((change) => ({
      owner: change.owner,
      ids: [...new Set(change.buildIds)].toSorted(),
    }));
    for (const change of normalized) checkAvailable(db, change.owner.projectId, change.ids);
    const result = await writeDomain(transactionStore(db));
    for (const change of normalized) {
      saveReferences(db, change.owner, change.ids);
      advanceGeneration(db, change.owner);
    }
    return result;
  });
}

/** Every mutation advances the fence, including legacy lifecycle entry points. */
function advanceGeneration(db: DatabaseSync, owner: BuildReferenceOwner): void {
  db.prepare(
    "INSERT INTO build_reference_generations (project_id, owner_type, owner_id, generation) VALUES (?, ?, ?, 1) ON CONFLICT (project_id, owner_type, owner_id) DO UPDATE SET generation = generation + 1",
  ).run(owner.projectId, owner.type, owner.id);
}

async function inTransaction<T>(path: string, work: (db: DatabaseSync) => Promise<T>): Promise<T> {
  const db = await open(path);
  try {
    const result = await work(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
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
    db.exec("ROLLBACK");
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
