import { PGlite } from "@electric-sql/pglite";
import { createShelfLogger } from "@storyshelf/core/logger";
import { describeSchemaLevelContract } from "@storyshelf/core/test-helpers";
import { createPgliteDatabase } from "./pglite.ts";

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
