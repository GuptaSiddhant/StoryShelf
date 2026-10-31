/** SQLite's write-serialized admission and irreversible deletion claim primitive. */
import type {
  BuildReferenceChange,
  BuildReferenceLifecycle,
  BuildReferenceOwner,
  TxStore,
} from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createHash } from "node:crypto";
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
    replaceReferences: async (owner, buildIds, writeDomain) =>
      await replaceManyReferences(path, [{ owner, buildIds }], writeDomain),
    replaceManyReferences: async (changes, writeDomain) =>
      await replaceManyReferences(path, changes, writeDomain),
    claimDeletion: async (projectId, buildId) =>
      await claimDeletion(path, projectId, buildId, onContention),
  };
}

/**
 * Prepare references before enabling lifecycle-aware writes. This is deliberately not called by
 * the adapter yet: all writers must participate in the same lifecycle before activation. Legacy
 * baselines with unknown provenance stay unknown; invalid recorded sources block activation.
 */
export async function backfillBaselineReferences(path: string): Promise<number> {
  return await inTransaction(path, async (db) => {
    const rows = db
      .prepare(
        "SELECT project_id, id, source_build_id FROM baselines WHERE source_build_id IS NOT NULL",
      )
      .all() as unknown as [string, string, string][];
    for (const [projectId, , buildId] of rows) checkAvailable(db, projectId, [buildId]);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO build_references (project_id, owner_type, owner_id, build_id) VALUES (?, 'baseline', ?, ?)",
    );
    for (const [projectId, baselineId, buildId] of rows) insert.run(projectId, baselineId, buildId);
    return await Promise.resolve(rows.length);
  });
}

/**
 * Atomically record and decrement one tombstoned build's manifest references. Call only after
 * successfully reading its complete manifest and before deleting that manifest from storage.
 * This primitive is not connected to purge until shared-asset admissions and recovery are safe.
 */
export async function accountBuildManifest(
  path: string,
  projectId: string,
  buildId: string,
  hashes: readonly string[],
): Promise<"accounted" | "already-accounted"> {
  if (hashes.some((hash) => !/^[a-f0-9]{64}$/u.test(hash)))
    throw new Error("Invalid manifest hash");
  const sorted = hashes.toSorted();
  const digest = createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
  // oxlint-disable-next-line eslint/max-statements -- the accounting and journal must share a transaction
  return await inTransaction(path, async (db) => {
    const build = db
      .prepare("SELECT retention_state FROM builds WHERE project_id = ? AND id = ?")
      .get(projectId, buildId) as unknown[] | undefined;
    if (build?.[0] !== "deleting") throw new Error("Build is not claimed for deletion");
    const prior = db
      .prepare(
        "SELECT manifest_hash FROM build_cleanup_accounting WHERE project_id = ? AND build_id = ?",
      )
      .get(projectId, buildId) as unknown[] | undefined;
    if (prior) {
      if (prior[0] !== digest) throw new Error("Build manifest changed during cleanup");
      return await Promise.resolve("already-accounted");
    }
    const update = db.prepare(
      "UPDATE content_refs SET ref_count = ref_count - 1, last_seen_at = ? WHERE hash = ? AND ref_count > 0",
    );
    const now = new Date().toISOString();
    for (const hash of sorted) {
      if (update.run(now, hash).changes !== 1)
        throw new Error("Manifest reference accounting is inconsistent");
    }
    db.prepare(
      "INSERT INTO build_cleanup_accounting (build_id, project_id, manifest_hash, accounted_at) VALUES (?, ?, ?, ?)",
    ).run(buildId, projectId, digest, now);
    return await Promise.resolve("accounted");
  });
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
    for (const change of normalized) saveReferences(db, change.owner, change.ids);
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
