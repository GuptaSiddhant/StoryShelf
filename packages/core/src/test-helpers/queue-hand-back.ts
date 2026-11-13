/**
 * Kind-claim and hand-back suite for the database capture queue (ADR 0053, decision 5): a consumer
 * claims only the kinds it has handlers for, and a job whose payload is newer than it reads goes
 * back to the queue with its attempt count unchanged. Database packages run it against their own
 * drivers, next to the single-flight suite:
 *
 * ```ts
 * databaseQueueHandBackSuite("sqlite", async () => await setUp(createSqliteDatabase(":memory:")));
 * ```
 *
 * Every case uses its own job ids, so a shared live database needs no cleanup between runs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseCaptureQueue } from "../capture/db-queue/index.ts";
import { CaptureJobModel } from "../models/capture-job.ts";
import type { SharedDatabaseFactory } from "./queue-multi-instance.ts";

const LEASE_MS = 60_000;

async function setup(makeDb: SharedDatabaseFactory) {
  const db = await makeDb();
  const clock = { now: Date.now() };
  const runId = `hb-${String(clock.now)}-${Math.random().toString(36).slice(2, 8)}`;
  const queue = createDatabaseCaptureQueue(db, {
    kinds: ["capture", "publish"],
    leaseMs: LEASE_MS,
    retries: 2,
    now: () => clock.now,
  });
  const model = new CaptureJobModel(db);
  const created: string[] = [];
  const create = async (name: string, kind: "capture" | "publish", payload: string | null) => {
    const id = `${runId}-${name}`;
    created.push(id);
    await model.create(
      { id, kind, buildId: id, maxAttempts: 3, payload },
      new Date(clock.now).toISOString(),
    );
    return id;
  };
  return {
    queue,
    model,
    create,
    /** End every job the case made, so a database shared by the cases polls nothing of theirs. */
    cleanup: async () => {
      for (const id of created) {
        // oxlint-disable-next-line no-await-in-loop -- few rows, in order
        await model.finishJob(id, "cancelled", new Date(clock.now).toISOString(), null);
      }
    },
    advance: (ms: number) => {
      clock.now += ms;
    },
  };
}

export function databaseQueueHandBackSuite(name: string, makeDb: SharedDatabaseFactory): void {
  describe(`kind claim and payload version hand-back on ${name}`, () => {
    const cleanups: (() => Promise<void>)[] = [];
    afterEach(async () => {
      for (const cleanup of cleanups.splice(0)) {
        // oxlint-disable-next-line no-await-in-loop -- one case at a time
        await cleanup();
      }
    });
    const start = async () => {
      const t = await setup(makeDb);
      cleanups.push(t.cleanup);
      return t;
    };

    it("leaves a kind the consumer has no handler for queued and unclaimed", async () => {
      const t = await start();
      t.queue.claimOnly(["capture"]);
      const id = await t.create("publish", "publish", null);
      expect(await t.queue.poll()).toBeNull();
      expect(await t.model.get(id)).toMatchObject({ status: "queued", attempt: 0, error: null });
      expect(await t.model.attempts(id)).toEqual([]);
    });

    it("claims every polled kind until the consumer narrows it", async () => {
      const t = await start();
      const id = await t.create("both", "publish", null);
      expect(await t.queue.poll()).toMatchObject({ jobId: id, kind: "publish", attempt: 1 });
    });

    it("runs a known kind as before: attempt 1, version 1, acked done", async () => {
      const t = await start();
      t.queue.claimOnly(["capture"]);
      const id = await t.create("known", "capture", '{"v":1}');
      const job = await t.queue.poll();
      expect(job).toMatchObject({ jobId: id, attempt: 1, payloadVersion: 1 });
      if (job === null) {
        throw new Error("expected a job");
      }
      await t.queue.ack(job);
      expect(await t.model.get(id)).toMatchObject({ status: "done", attempt: 1 });
    });

    it("reads a payload with no version as version 1", async () => {
      const t = await start();
      await t.create("legacy", "capture", '{"data":{"a":1}}');
      expect(await t.queue.poll()).toMatchObject({ payloadVersion: 1, data: { a: 1 } });
    });

    it("hands a job back without spending an attempt, and the next claim reuses the number", async () => {
      const t = await start();
      const id = await t.create("newer", "capture", '{"v":2}');
      const job = await t.queue.poll();
      expect(job).toMatchObject({ jobId: id, attempt: 1, payloadVersion: 2 });
      if (job === null) {
        throw new Error("expected a job");
      }
      await t.queue.handBack?.(job, { delayMs: 5000 });

      expect(await t.model.get(id)).toMatchObject({ status: "queued", attempt: 0 });
      expect(await t.model.attempts(id)).toEqual([]);
      expect(await t.queue.poll()).toBeNull();

      t.advance(5001);
      expect(await t.queue.poll()).toMatchObject({ jobId: id, attempt: 1, attempts: 0 });
    });

    it("lets a stale holder hand back nothing", async () => {
      const t = await start();
      const id = await t.create("stale", "capture", '{"v":2}');
      const job = await t.queue.poll();
      if (job === null) {
        throw new Error("expected a job");
      }
      await t.queue.ack(job);
      await t.queue.handBack?.(job);
      expect(await t.model.get(id)).toMatchObject({ status: "done", attempt: 1 });
    });
  });
}
