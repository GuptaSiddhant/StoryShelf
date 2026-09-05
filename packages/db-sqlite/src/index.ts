import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createDrizzleAdapter } from "@storyshelf/core/adapter/database";
import { DDL } from "@storyshelf/core/ddl";
import { schema } from "@storyshelf/core/schema";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

declare const __PKG_VERSION__: string | undefined;

const STORYBOOK_META_ALTER = "ALTER TABLE projects ADD COLUMN storybook_meta TEXT";

/**
 * Create a SQLite-backed DatabaseAdapter using better-sqlite3 and Drizzle ORM.
 *
 * @param path - Filesystem path to the SQLite database file.
 * @returns A DatabaseAdapter backed by the given SQLite file (WAL mode).
 */
export function createSqliteDatabase(path: string): DatabaseAdapter {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });

  return createDrizzleAdapter(db, {
    metadata: {
      name: "SQLite",
      version: (globalThis as unknown as { __PKG_VERSION__?: string }).__PKG_VERSION__ ?? "0.0.0",
      description: "SQLite database adapter (better-sqlite3 + Drizzle)",
      kind: "sqlite",
    },
    migrate: () => {
      sqlite.exec(DDL);
      try {
        sqlite.exec(STORYBOOK_META_ALTER);
      } catch {
        // Column already exists or other error — ignore for idempotency
      }
    },
    close: () => {
      sqlite.close();
    },
  });
}
