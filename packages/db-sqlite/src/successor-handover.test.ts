/**
 * The single-flight hand-over (ADR 0040) on a real transactional adapter: `node:sqlite`, where a
 * rollback really undoes the end of the job and a second settler really waits for the first.
 */
import type { DatabaseAdapter, TxStore } from "@storyshelf/core/adapter/database";
import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import { CaptureJobModel } from "@storyshelf/core/models";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
const KEY = "capture:b1";

async function freshDatabase(): Promise<DatabaseAdapter> {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silent });
  return db;
}

/** A running single-flight job with one request waiting on it. */
async function runningJobWithRequest(db: DatabaseAdapter) {
  const queue = createDatabaseCaptureQueue(db, { kinds: ["capture"] });
  const id = await queue.enqueueJob({ kind: "capture", buildId: "b1", activeKey: KEY });
  const job = await queue.poll();
  if (job === null) throw new Error("the job was not claimed");
  // A request while the job runs is coalesced into a marker on it.
  expect(await queue.enqueueJob({ kind: "capture", buildId: "b1", activeKey: KEY })).toBe(id);
  return { queue, id, job };
}

const queuedFor = async (db: DatabaseAdapter, exceptId: string) =>
  (await new CaptureJobModel(db).listRecent(["capture"], 10)).filter(
    (row) => row.jobId !== exceptId,
  );

describe("the single-flight hand-over on node:sqlite", () => {
  it("queues exactly one successor with the key when the job is acknowledged", async () => {
    const db = await freshDatabase();
    const { queue, id, job } = await runningJobWithRequest(db);

    await queue.ack(job);

    const successors = await queuedFor(db, id);
    expect(successors).toHaveLength(1);
    expect(successors[0]).toMatchObject({ status: "queued", activeKey: KEY });
    expect(await new CaptureJobModel(db).get(id)).toMatchObject({
      status: "done",
      activeKey: null,
      rerunRequestedAt: null,
    });
  });

  it("queues one successor when two settlers acknowledge the job together", async () => {
    const db = await freshDatabase();
    const { queue, id, job } = await runningJobWithRequest(db);

    await Promise.all([queue.ack(job), queue.ack(job)]);

    expect(await queuedFor(db, id)).toHaveLength(1);
  });

  it("rolls the end back when the successor cannot be inserted, so the request is not lost", async () => {
    const real = await freshDatabase();
    // The successor insert fails inside the real transaction; SQLite undoes the job's end with it.
    const failing: DatabaseAdapter = {
      ...real,
      transact: async <R>(fn: (tx: TxStore) => Promise<R>): Promise<R> =>
        await (real.transact as NonNullable<DatabaseAdapter["transact"]>)<R>(
          async (tx) =>
            await fn({
              ...tx,
              insert: async (table, values) => {
                if (table === real.tables.captureJobs) throw new Error("insert refused");
                return await tx.insert(table, values);
              },
            }),
        ),
    };
    const { queue, id, job } = await runningJobWithRequest(failing);

    await expect(queue.ack(job)).rejects.toThrow("insert refused");

    expect(await new CaptureJobModel(real).get(id)).toMatchObject({
      status: "running",
      activeKey: KEY,
    });
    expect((await new CaptureJobModel(real).get(id))?.rerunRequestedAt).toBeTruthy();
    expect(await queuedFor(real, id)).toEqual([]);
  });
});
