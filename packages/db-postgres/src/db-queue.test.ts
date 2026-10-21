/**
 * The database capture queue on embedded Postgres (PGlite): the queue contract, the multi-instance
 * suite (several queue instances on one database) and the query plan of the poll probe.
 */
import { PGlite } from "@electric-sql/pglite";
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import { databaseQueueMultiInstanceSuite, queueContractSuite } from "@storyshelf/core/test-helpers";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createPgliteDatabase } from "./pglite.ts";

const silent = createShelfLogger({ level: "silent" });

// PGlite boots a WASM Postgres in seconds (more under a parallel turbo run), so the file shares one
// database: the suites use unique build ids and skip each other's leftovers.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
let shared: Promise<DatabaseAdapter> | undefined;

async function freshDatabase(): Promise<DatabaseAdapter> {
  shared ??= (async () => {
    const db = createPgliteDatabase();
    await db.lifecycle?.setup({ config: {}, logger: silent });
    return db;
  })();
  return await shared;
}

afterAll(async () => {
  await (await shared)?.lifecycle?.teardown();
});

const clock = { now: Date.parse("2026-01-01T00:00:00.000Z") };

queueContractSuite(
  "database (PGlite)",
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

databaseQueueMultiInstanceSuite("PGlite", freshDatabase);

describe("poll probe on Postgres", () => {
  it("is an index scan of capture_jobs_poll_idx with no sort", async () => {
    const client = new PGlite();
    const db = createPgliteDatabase({ client });
    await db.lifecycle?.setup({ config: {}, logger: silent });
    // An empty table would be seq-scanned; ask the planner for the plan it uses on a real queue.
    await client.exec("SET enable_seqscan = off");
    const plan = await client.query<{ "QUERY PLAN": string }>(`
      EXPLAIN SELECT * FROM capture_jobs
      WHERE kind = 'capture' AND visible_at <= '2026-01-01T00:00:00.000Z'
        AND status IN ('queued', 'running')
      ORDER BY visible_at ASC LIMIT 1`);
    const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    expect(text).toMatch(/Index (?:Only )?Scan using capture_jobs_poll_idx/u);
    expect(text).not.toMatch(/Sort/u);
    await client.close();
  });
});
