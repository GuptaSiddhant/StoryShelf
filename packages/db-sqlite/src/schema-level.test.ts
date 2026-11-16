import { createShelfLogger } from "@storyshelf/core/logger";
import { describeSchemaLevelContract } from "@storyshelf/core/test-helpers";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describeSchemaLevelContract("SQLite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "storyshelf-schema-level-"));
  dirs.push(dir);
  const path = join(dir, "db.sqlite");
  const raw = <T>(use: (db: DatabaseSync) => T): T => {
    const db = new DatabaseSync(path);
    try {
      return use(db);
    } finally {
      db.close();
    }
  };
  return {
    open: async (release) => {
      const db = createSqliteDatabase(path);
      try {
        await db.lifecycle?.setup({
          config: {},
          logger: silent,
          ...(release === null ? {} : { release }),
        });
      } finally {
        await db.lifecycle?.teardown();
      }
    },
    dropSentinel: async () => {
      raw((db) => db.exec("DROP TABLE site_settings"));
      return await Promise.resolve();
    },
    hasSentinel: async () =>
      await Promise.resolve(
        raw(
          (db) =>
            db.prepare("SELECT name FROM sqlite_master WHERE name = 'site_settings'").all().length >
            0,
        ),
      ),
    recorded: async () =>
      await Promise.resolve(
        raw((db) => {
          const exists = db
            .prepare("SELECT name FROM sqlite_master WHERE name = 'schema_meta'")
            .all();
          if (exists.length === 0) return null;
          const row = db.prepare("SELECT version FROM schema_meta").get() as
            | { version: string }
            | undefined;
          return row?.version ?? null;
        }),
      ),
    dropMeta: async () => {
      raw((db) => db.exec("DROP TABLE schema_meta"));
      return await Promise.resolve();
    },
  };
});
