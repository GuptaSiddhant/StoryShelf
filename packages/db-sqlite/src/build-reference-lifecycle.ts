/** SQLite's write-serialized admission and irreversible deletion claim primitive. */
import type {
  BuildReferenceLifecycle,
  BuildReferenceOwner,
  TxStore,
} from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { createDrizzleAdapter } from "./drizzle-factory.ts";
import { createCallback } from "./index.ts";
import { schema } from "./schema/index.ts";

/** Not yet exposed by the adapter: all domain mutations and cleanup must be wired first. */
export function createBuildReferenceLifecycle(path: string): BuildReferenceLifecycle {
  return {
    replaceReferences: async (owner, buildIds, writeDomain) =>
      await replaceReferences(path, owner, buildIds, writeDomain),
    claimDeletion: async (projectId, buildId) => await claimDeletion(path, projectId, buildId),
  };
}

async function open(path: string): Promise<DatabaseSync> {
  if (path === ":memory:") throw new Error("Reference lifecycle requires a shared SQLite file");
  const db = new DatabaseSync(path, { returnArrays: true });
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0");
    await acquireWrite(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Avoid blocking this process's event loop while a different connection holds the write lock. */
async function acquireWrite(db: DatabaseSync): Promise<void> {
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

async function replaceReferences<T>(
  path: string,
  owner: BuildReferenceOwner,
  buildIds: readonly string[],
  writeDomain: (tx: TxStore) => Promise<T>,
): Promise<T> {
  return await inTransaction(path, async (db) => {
    const ids = [...new Set(buildIds)].toSorted();
    checkAvailable(db, owner.projectId, ids);
    const result = await writeDomain(transactionStore(db));
    saveReferences(db, owner, ids);
    return result;
  });
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
): Promise<"claimed" | "protected" | "deleting" | "missing"> {
  const db = await open(path);
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
