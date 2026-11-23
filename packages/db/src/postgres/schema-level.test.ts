import { PGlite } from "@electric-sql/pglite";
import { createShelfLogger } from "@storyshelf/core/logger";
import { describeSchemaLevelContract } from "@storyshelf/core/test-helpers";
import { vi } from "vitest";
import { createPgliteDatabase } from "./pglite.ts";

// Each case boots a fresh PGlite (WASM) and runs every migration, which outlasts vitest's
// default 5 s on a loaded CI runner; the same limits as the package's other PGlite suites.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const silent = createShelfLogger({ level: "silent" });

describeSchemaLevelContract("PGlite", async () => {
  const client = new PGlite();
  const count = async (sql: string): Promise<number> => (await client.query(sql)).rows.length;
  return {
    open: async (release) => {
      const db = createPgliteDatabase({ client });
      await db.lifecycle?.setup({
        config: {},
        logger: silent,
        ...(release === null ? {} : { release }),
      });
    },
    dropSentinel: async () => {
      await client.exec("DROP TABLE site_settings");
    },
    hasSentinel: async () =>
      (await count("SELECT 1 FROM information_schema.tables WHERE table_name = 'site_settings'")) >
      0,
    recorded: async () => {
      const tables = await count(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_meta'",
      );
      if (tables === 0) return null;
      const rows = (await client.query("SELECT version FROM schema_meta")).rows as {
        version: string;
      }[];
      return rows[0]?.version ?? null;
    },
    dropMeta: async () => {
      await client.exec("DROP TABLE schema_meta");
    },
  };
});
