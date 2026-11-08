/**
 * Single-flight suite for the database capture queue (ADR 0040): a job enqueued with an
 * `activeKey` is held by the database's unique `capture_jobs.active_key`, so at most one
 * non-terminal job per key exists however many instances enqueue at once. Database packages run it
 * against their own drivers, next to the multi-instance suite:
 *
 * ```ts
 * import { databaseQueueSingleFlightSuite } from "@storyshelf/core/test-helpers";
 * databaseQueueSingleFlightSuite("sqlite", async () => await setUp(createSqliteDatabase(":memory:")));
 * ```
 *
 * The instances share one manual clock, and every case uses its own build id, so a shared live
 * database needs no cleanup between runs.
 */
import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import {
  createDatabaseCaptureQueue,
  type DatabaseCaptureQueue,
  type DatabaseJob,
} from "../capture/db-queue/index.ts";
import { CaptureJobModel } from "../models/capture-job.ts";
import type { CaptureJobRow } from "../schema/capture-job.ts";
import type { SharedDatabaseFactory } from "./queue-multi-instance.ts";

const LEASE_MS = 60_000;

interface Fleet {
  db: DatabaseAdapter;
  model: CaptureJobModel;
  queues: DatabaseCaptureQueue[];
  advance: (ms: number) => void;
  /** A key and build id no other case of this run uses. */
  fresh: (name: string) => { buildId: string; key: string };
}

async function fleet(makeDb: SharedDatabaseFactory, size: number): Promise<Fleet> {
  const db = await makeDb();
  const clock = { now: Date.now() };
  const runId = `sf-${String(clock.now)}-${Math.random().toString(36).slice(2, 8)}`;
  const queues = Array.from({ length: size }, (_unused, index) =>
    createDatabaseCaptureQueue(db, {
      kinds: ["notify"],
      leaseMs: LEASE_MS,
      retries: 2,
      owner: `instance-${String(index)}`,
      now: () => clock.now,
    }),
  );
  return {
    db,
    model: new CaptureJobModel(db),
    queues,
    advance: (ms) => {
      clock.now += ms;
    },
    fresh: (name) => ({ buildId: `${runId}-${name}`, key: `notify:${runId}-${name}:chan` }),
  };
}

function first(queues: DatabaseCaptureQueue[]): DatabaseCaptureQueue {
  const [queue] = queues;
  if (queue === undefined) {
    throw new Error("empty fleet");
  }
  return queue;
}

function enqueue(
  queue: DatabaseCaptureQueue,
  target: { buildId: string; key: string },
  channelId = "chan",
): Promise<string> {
  return queue.enqueueJob({
    kind: "notify",
    buildId: target.buildId,
    data: { channelId },
    maxAttempts: 3,
    activeKey: target.key,
  });
}

/**
 * Poll until the job of `buildId` comes (or the queue is empty). On a database shared with other
 * suites, leftover jobs of other builds are acked away, as the multi-instance suite does. Instances
 * polling together can lose every claim try to a faster one while leftovers are ahead of the job, so
 * an empty answer is asked again a few times before it counts.
 */
async function pollFor(queue: DatabaseCaptureQueue, buildId: string): Promise<DatabaseJob | null> {
  let empty = 0;
  for (let tries = 0; tries < 50 && empty < EMPTY_POLLS; tries += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential polls are the point
    const job = await queue.poll();
    if (job === null) {
      empty += 1;
    } else if (job.buildId === buildId) {
      return job;
    } else {
      // oxlint-disable-next-line eslint/no-await-in-loop -- clear a leftover of another case
      await queue.ack(job);
    }
  }
  return null;
}

/** Empty answers in a row that count as an empty queue. */
const EMPTY_POLLS = 3;

async function claimed(queues: DatabaseCaptureQueue[], buildId: string): Promise<DatabaseJob[]> {
  const jobs = await Promise.all(queues.map(async (queue) => await pollFor(queue, buildId)));
  return jobs.filter((job): job is DatabaseJob => job !== null);
}

async function rowsOf(fleetOf: Fleet, buildId: string): Promise<CaptureJobRow[]> {
  return await fleetOf.model.listForBuild(buildId);
}

/** Run the single-flight suite against databases from `makeDb`. */
export function databaseQueueSingleFlightSuite(
  label: string,
  makeDb: SharedDatabaseFactory,
  options: { instances?: number; timeoutMs?: number } = {},
): void {
  const size = options.instances ?? 3;
  describe(`database queue, single-flight keys: ${label}`, () => {
    enqueueCases(makeDb, size, options.timeoutMs);
    runningCases(makeDb, size, options.timeoutMs);
    endingCases(makeDb, size, options.timeoutMs);
  });
}

function enqueueCases(makeDb: SharedDatabaseFactory, size: number, timeoutMs?: number): void {
  it(
    "creates exactly one job for concurrent enqueues of one key",
    async () => {
      const f = await fleet(makeDb, size);
      const target = f.fresh("concurrent");
      const ids = await Promise.all(
        Array.from({ length: 12 }, async (_unused, index) =>
          enqueue(f.queues[index % size] ?? first(f.queues), target),
        ),
      );
      expect(new Set(ids).size).toBe(1);
      const rows = await rowsOf(f, target.buildId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: ids[0], status: "queued", activeKey: target.key });
    },
    timeoutMs,
  );

  it(
    "coalesces a request into the queued job that holds the key",
    async () => {
      const f = await fleet(makeDb, size);
      const target = f.fresh("queued");
      const one = await enqueue(first(f.queues), target);
      const two = await enqueue(first(f.queues), target);
      expect(two).toBe(one);
      expect(await rowsOf(f, target.buildId)).toHaveLength(1);
    },
    timeoutMs,
  );

  it(
    "does not let different keys for the same build block each other",
    async () => {
      const f = await fleet(makeDb, size);
      const target = f.fresh("channels");
      const a = await enqueue(first(f.queues), target, "a");
      const b = await enqueue(first(f.queues), { ...target, key: `${target.key}:other` }, "b");
      expect(a).not.toBe(b);
      expect((await claimed(f.queues, target.buildId)).map((job) => job.jobId).toSorted()).toEqual(
        [a, b].toSorted(),
      );
    },
    timeoutMs,
  );
}

function runningCases(makeDb: SharedDatabaseFactory, size: number, timeoutMs?: number): void {
  it(
    "never lets two instances run the same key at once",
    async () => {
      const f = await fleet(makeDb, size);
      const target = f.fresh("exclusive");
      await enqueue(first(f.queues), target);
      expect(await claimed(f.queues, target.buildId)).toHaveLength(1);
      // A request now marks the running job; it does not become a second claimable job.
      await enqueue(first(f.queues), target);
      expect(await claimed(f.queues, target.buildId)).toHaveLength(0);
      expect(await rowsOf(f, target.buildId)).toHaveLength(1);
    },
    timeoutMs,
  );

  it(
    "asks the running job for one more pass, delivered by a successor, however many requests came",
    async () => {
      const f = await fleet(makeDb, size);
      const target = f.fresh("rerun");
      const q = first(f.queues);
      const original = await enqueue(q, target);
      const running = await pollFor(q, target.buildId);
      expect(running?.jobId).toBe(original);
      expect(await enqueue(q, target)).toBe(original);
      expect(await enqueue(q, target)).toBe(original);
      expect((await f.model.get(original))?.rerunRequestedAt).not.toBeNull();

      if (running === null) throw new Error("job not claimed");
      await q.ack(running);

      const rows = await rowsOf(f, target.buildId);
      expect(rows.map((row) => row.status).toSorted()).toEqual(["done", "queued"]);
      const successor = rows.find((row) => row.id !== original);
      expect(successor).toMatchObject({ activeKey: target.key, maxAttempts: 3 });
      expect(rows.find((row) => row.id === original)?.activeKey).toBeNull();
      const next = await pollFor(q, target.buildId);
      expect(next).toMatchObject({ jobId: successor?.id, data: { channelId: "chan" } });
      if (next === null) throw new Error("successor not claimed");
      await q.ack(next);
      expect(await pollFor(q, target.buildId)).toBeNull();
      expect(await rowsOf(f, target.buildId)).toHaveLength(2);
    },
    timeoutMs,
  );

  it(
    "covers a request made before a takeover by the new attempt, and one made after it by a successor",
    async () => {
      const f = await fleet(makeDb, size);
      const target = f.fresh("lease");
      const [a, b] = f.queues;
      if (a === undefined || b === undefined) throw new Error("needs two instances");
      const original = await enqueue(a, target);
      const lost = await pollFor(a, target.buildId);
      expect(lost?.jobId).toBe(original);
      await enqueue(a, target);
      f.advance(LEASE_MS + 1);
      const takeover = await pollFor(b, target.buildId);
      expect(takeover).toMatchObject({ jobId: original, attempt: 2 });
      if (takeover === null || lost === null) throw new Error("not claimed");
      // The new attempt starts after the first request, so it reads state that includes it.
      expect((await f.model.get(original))?.rerunRequestedAt).toBeNull();
      await enqueue(b, target);
      await b.ack(takeover);
      // The late holder writes nothing.
      await a.nack(lost, { requeue: false, error: "late" });

      const rows = await rowsOf(f, target.buildId);
      expect(rows.filter((row) => row.status === "queued")).toHaveLength(1);
      expect(rows.find((row) => row.id === original)?.status).toBe("done");
    },
    timeoutMs,
  );
}

function endingCases(makeDb: SharedDatabaseFactory, size: number, timeoutMs?: number): void {
  it(
    "frees the key when a job ends, so a later request creates a new job",
    async () => {
      const f = await fleet(makeDb, size);
      const target = f.fresh("freed");
      const q = first(f.queues);
      const one = await enqueue(q, target);
      const job = await pollFor(q, target.buildId);
      if (job === null) throw new Error("not claimed");
      await q.ack(job);
      expect((await f.model.get(one))?.activeKey).toBeNull();
      const two = await enqueue(q, target);
      expect(two).not.toBe(one);
      expect(await pollFor(q, target.buildId)).toMatchObject({ jobId: two });
    },
    timeoutMs,
  );

  it(
    "gives a request that arrived during a failed pass a job of its own",
    async () => {
      const f = await fleet(makeDb, size);
      const target = f.fresh("failed");
      const q = first(f.queues);
      const original = await enqueue(q, target);
      const job = await pollFor(q, target.buildId);
      if (job === null) throw new Error("not claimed");
      await enqueue(q, target);
      await q.nack(job, { requeue: false, error: "provider refused" });
      const rows = await rowsOf(f, target.buildId);
      expect(rows.find((row) => row.id === original)).toMatchObject({
        status: "failed",
        activeKey: null,
      });
      expect(rows.filter((row) => row.status === "queued")).toHaveLength(1);
    },
    timeoutMs,
  );

  it(
    "does not ask for a successor when the job is cancelled, and frees the key",
    async () => {
      const f = await fleet(makeDb, size);
      const target = f.fresh("cancelled");
      const q = first(f.queues);
      const original = await enqueue(q, target);
      const job = await pollFor(q, target.buildId);
      if (job === null) throw new Error("not claimed");
      await enqueue(q, target);
      expect(await q.cancel(original)).toBe(true);
      await q.nack(job, { requeue: false, error: "cancelled" });
      const rows = await rowsOf(f, target.buildId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "cancelled", activeKey: null });
      expect(await enqueue(q, target)).not.toBe(original);
    },
    timeoutMs,
  );

  it(
    "lets a retried attempt cover the request that was made before it started",
    async () => {
      const f = await fleet(makeDb, size);
      const target = f.fresh("retry");
      const q = first(f.queues);
      const original = await enqueue(q, target);
      const job = await pollFor(q, target.buildId);
      if (job === null) throw new Error("not claimed");
      await enqueue(q, target);
      await q.nack(job, { requeue: true, error: "try again" });
      const requeued = await f.model.get(original);
      expect(requeued).toMatchObject({ status: "queued", activeKey: target.key });
      f.advance(MAX_DELAY_MS);
      const retry = await pollFor(q, target.buildId);
      expect(retry).toMatchObject({ jobId: original, attempt: 2 });
      expect((await f.model.get(original))?.rerunRequestedAt).toBeNull();
      if (retry === null) throw new Error("not claimed");
      await q.ack(retry);
      expect(await rowsOf(f, target.buildId)).toHaveLength(1);
    },
    timeoutMs,
  );

  it(
    "never puts the key on an attempt row",
    async () => {
      const f = await fleet(makeDb, size);
      const target = f.fresh("attempts");
      const q = first(f.queues);
      const original = await enqueue(q, target);
      expect(await pollFor(q, target.buildId)).not.toBeNull();
      const attempts = await f.model.attempts(original);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.activeKey).toBeNull();
    },
    timeoutMs,
  );
}

/** Past any retry delay the queue computes in these cases. */
const MAX_DELAY_MS = LEASE_MS;
