/** A real instance module for the bin's tests: SQLite and local storage in a scratch directory, admin token `test-admin`. */
import { createLocalStorage } from "@storyshelf/core/storage/local";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import type { ShelfApp } from "../../app-types.ts";
import { createShelfApp } from "../../index.tsx";

/** A fresh app (own scratch directory): a torn-down app is closed for good, so each test makes its own. */
export function createFixtureApp(): ShelfApp {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-bin-"));
  return createShelfApp({
    database: createSqliteDatabase(join(dir, "shelf.db")),
    storage: createLocalStorage(dir),
    logger: pino({ level: "silent" }),
    config: { scratchDir: dir, adminToken: "test-admin" },
  });
}
