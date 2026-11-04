/** Connections for the lifecycle: one short write transaction per operation, serialized by SQLite. */
import type { TxStore } from "@storyshelf/core/adapter/database";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { createDrizzleAdapter } from "./drizzle-factory.ts";
import { createCallback } from "./index.ts";
import { schema } from "./schema/index.ts";

export async function open(path: string, onContention?: () => void): Promise<DatabaseSync> {
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

export function transactionStore(db: DatabaseSync): TxStore {
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

export async function inTransaction<T>(
  path: string,
  work: (db: DatabaseSync) => Promise<T>,
): Promise<T> {
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
