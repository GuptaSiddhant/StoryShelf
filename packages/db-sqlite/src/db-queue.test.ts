/**
 * The database capture queue on node:sqlite: the queue contract, the multi-instance suite (several
 * queue instances on one database), and the query plan of the poll probe.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import { databaseQueueMultiInstanceSuite, queueContractSuite } from "@storyshelf/core/test-helpers";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });

async function freshDatabase(): Promise<DatabaseAdapter> {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silent });
  return db;
}

const clock = { now: Date.parse("2026-01-01T00:00:00.000Z") };

queueContractSuite(
  "database (node:sqlite)",
  async () =>
    createDatabaseCaptureQueue(await freshDatabase(), {
      leaseMs: 60_000,
      retries: 2,
      now: () => clock.now,
    }),
  {
    pollable: {
      advance: (ms) => {
        clock.now += ms;
      },
      leaseMs: 60_000,
      retries: 2,
    },
  },
);

databaseQueueMultiInstanceSuite("node:sqlite", freshDatabase);

describe("poll probe on SQLite", () => {
  it("is one range scan of capture_jobs_poll_idx with no sort", async () => {
    const db = await freshDatabase();
    const plan = await db.all<unknown>(sql`
      EXPLAIN QUERY PLAN
      SELECT * FROM capture_jobs
      WHERE kind = 'capture' AND visible_at <= '2026-01-01T00:00:00.000Z'
        AND status IN ('queued', 'running')
      ORDER BY visible_at ASC LIMIT 1`);
    // Rows come back as objects or value arrays depending on the driver; the plan text is in them.
    const details = JSON.stringify(plan);
    expect(details).toMatch(/USING (?:COVERING )?INDEX capture_jobs_poll_idx/u);
    expect(details).not.toMatch(/TEMP B-TREE/u);
  });
});
