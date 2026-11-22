import type { ShelfOptions } from "@storyshelf/core/config";
/** Real options for the bin's tests: SQLite and local storage in a data directory, admin token `test-admin`. */
import { createLocalStorage } from "@storyshelf/core/storage/local";
import { createSqliteDatabase } from "@storyshelf/db/sqlite";
import { join } from "node:path";
import pino from "pino";

/** Fresh adapters over `dataDir`: the database file is `shelf.db` there. */
export function fixtureOptions(dataDir: string): ShelfOptions {
  return {
    database: createSqliteDatabase(join(dataDir, "shelf.db")),
    storage: createLocalStorage(dataDir),
    logger: pino({ level: "silent" }),
    config: { scratchDir: dataDir, adminToken: "test-admin" },
  };
}
