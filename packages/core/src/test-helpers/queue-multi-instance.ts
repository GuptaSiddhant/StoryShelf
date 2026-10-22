/**
 * Multi-instance suite for the database capture queue: several queue instances (one per simulated
 * app instance) share ONE database, the way horizontally scaled app instances do. Database packages
 * run it against their own drivers (node:sqlite, PGlite, and the gated live Postgres, MySQL and
 * Turso tests):
 *
 * ```ts
 * import { databaseQueueMultiInstanceSuite } from "@storyshelf/core/test-helpers";
 * databaseQueueMultiInstanceSuite("sqlite", async () => await setUp(createSqliteDatabase(":memory:")));
 * ```
 *
 * Every instance reads one shared manual clock, so lease expiry and retry delays are exact and no
 * case sleeps. Build ids are unique per run, so a shared live database needs no cleanup between runs.
 */
import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import {
  createDatabaseCaptureQueue,
  LEASE_EXHAUSTED_ERROR,
  type DatabaseCaptureQueue,
  type DatabaseJob,
} from "../capture/db-queue/index.ts";
import { attemptRowId, CaptureJobModel } from "../models/capture-job.ts";
import type { CaptureJobKind } from "../schema/capture-job.ts";

/** A set-up database the instances of one case share. */
export type SharedDatabaseFactory = () => DatabaseAdapter | Promise<DatabaseAdapter>;

/** Options of {@link databaseQueueMultiInstanceSuite}. */
export interface MultiInstanceOptions {
  /** Queue instances sharing the database (default 4). */
  instances?: number;
  /** Jobs in the exactly-once case (default 24). */
  jobs?: number;
  /** Per-case timeout in ms, for slow remote databases (default vitest's). */
  timeoutMs?: number;
}

const LEASE_MS = 60_000;
const RETRIES = 2;

interface Fleet {
  db: DatabaseAdapter;
  queues: DatabaseCaptureQueue[];
  advance: (ms: number) => void;
  runId: string;
}

async function fleet(
  makeDb: SharedDatabaseFactory,
  size: number,
  kinds: readonly CaptureJobKind[] = ["capture"],
): Promise<Fleet> {
  const db = await makeDb();
  const clock = { now: Date.now() };
  const queues = Array.from({ length: size }, (_unused, index) =>
    createDatabaseCaptureQueue(db, {
      kinds,
      leaseMs: LEASE_MS,
      retries: RETRIES,
      owner: `instance-${String(index)}`,
      now: () => clock.now,
    }),
  );
  const advance = (ms: number): void => {
    clock.now += ms;
  };
  return {
    db,
    queues,
    advance,
    runId: `mi-${String(clock.now)}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

/** Poll on every instance at once, as concurrent app instances would. */
async function pollAll(queues: DatabaseCaptureQueue[]): Promise<DatabaseJob[]> {
  const jobs = await Promise.all(queues.map(async (queue) => await queue.poll()));
  return jobs.filter((job): job is DatabaseJob => job !== null);
}

/** Poll every instance until one returns the job of `buildId` (others' jobs are acked away). */
async function claimOn(queue: DatabaseCaptureQueue, buildId: string): Promise<DatabaseJob | null> {
  for (let tries = 0; tries < 50; tries += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential polls are the point
    const job = await queue.poll();
    if (job === null || job.buildId === buildId) {
      return job;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- clear a leftover of another case
    await queue.ack(job);
  }
  return null;
}

/** Run the multi-instance suite against databases from `makeDb`. */
export function databaseQueueMultiInstanceSuite(
  label: string,
  makeDb: SharedDatabaseFactory,
  options: MultiInstanceOptions = {},
): void {
  const size = options.instances ?? 4;
  const jobs = options.jobs ?? 24;
  describe(`database queue, ${String(size)} instances on one database: ${label}`, () => {
    exactlyOnceCase(makeDb, size, jobs, options.timeoutMs);
    leaseCases(makeDb, size, options.timeoutMs);
    retryCases(makeDb, size, options.timeoutMs);
    cancelAndKindCases(makeDb, size, options.timeoutMs);
  });
}

function exactlyOnceCase(
  makeDb: SharedDatabaseFactory,
  size: number,
  jobs: number,
  timeoutMs?: number,
): void {
  it(
    "runs each job exactly once across instances polling at the same time",
    async () => {
      const { queues, runId } = await fleet(makeDb, size);
      const ids = Array.from({ length: jobs }, (_unused, index) => `${runId}-${String(index)}`);
      await Promise.all(
        ids.map(async (buildId, index) => await queues[index % size]!.enqueue({ buildId })),
      );
      const claims = new Map<string, number>();
      const ours = new Set(ids);
      for (let round = 0; round < jobs * 2 + 20 && claims.size < jobs; round += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- rounds of concurrent polls
        const claimed = await pollAll(queues);
        // A shared (live) database may hold other runs' jobs: settle them, count only ours.
        for (const job of claimed.filter((one) => ours.has(one.buildId))) {
          claims.set(job.buildId, (claims.get(job.buildId) ?? 0) + 1);
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- see above
        await Promise.all(claimed.map(async (job) => await queues[0]!.ack(job)));
      }
      expect([...claims.keys()].toSorted()).toEqual(ids.toSorted());
      expect([...claims.values()].every((count) => count === 1)).toBe(true);
      const statuses = await Promise.all(
        ids.map(async (id) => (await queues[1]!.status(id))?.status),
      );
      expect(new Set(statuses)).toEqual(new Set(["completed"]));
    },
    timeoutMs,
  );
}

function leaseCases(makeDb: SharedDatabaseFactory, size: number, timeoutMs?: number): void {
  it(
    "redelivers an expired lease to another instance and fences the stale holder",
    async () => {
      const { db, queues, advance, runId } = await fleet(makeDb, size);
      const [first, second] = [queues[0]!, queues[1]!];
      const buildId = `${runId}-lease`;
      await first.enqueue({ buildId });
      const stale = await claimOn(first, buildId);
      expect(stale?.attempt).toBe(1);
      expect(await claimOn(second, buildId)).toBeNull();
      advance(LEASE_MS + 1);
      // Every instance races for the expired lease; exactly one wins.
      const winners = (await pollAll(queues)).filter((job) => job.buildId === buildId);
      expect(winners).toHaveLength(1);
      const fresh = winners[0]!;
      expect(fresh.attempt).toBe(2);
      const model = new CaptureJobModel(db);
      const leaseBefore = (await model.get(attemptRowId(fresh.jobId, 2)))?.visibleAt;
      expect(await first.extend(stale!)).toBe("lost");
      expect(await first.inspect(stale!)).toBe("lost");
      await first.nack(stale!, { requeue: true, error: "stale" });
      const after = await model.get(fresh.jobId);
      expect(after).toMatchObject({ status: "running", attempt: 2 });
      expect((await model.get(attemptRowId(fresh.jobId, 2)))?.visibleAt).toBe(leaseBefore);
      expect((await model.get(attemptRowId(fresh.jobId, 1)))?.status).toBe("expired");
      expect(await second.extend(fresh)).toBe("ok");
      await second.ack(fresh);
      // A late finish by the stale holder costs a duplicate run, never a wrong result.
      await first.ack(stale!);
      expect((await second.status(buildId))?.status).toBe("completed");
    },
    timeoutMs,
  );
}

function retryCases(makeDb: SharedDatabaseFactory, size: number, timeoutMs?: number): void {
  it(
    "fails a job on any instance once its retries are spent",
    async () => {
      const { queues, advance, runId } = await fleet(makeDb, size);
      const buildId = `${runId}-retry`;
      await queues[0]!.enqueue({ buildId });
      for (let attempt = 1; attempt <= RETRIES + 1; attempt += 1) {
        const queue = queues[attempt % size]!;
        // oxlint-disable-next-line eslint/no-await-in-loop -- attempts are sequential
        const job = await claimOn(queue, buildId);
        expect(job?.attempt).toBe(attempt);
        // oxlint-disable-next-line eslint/no-await-in-loop -- see above
        await queue.nack(job!, { requeue: true, delayMs: 1000, error: `boom ${String(attempt)}` });
        advance(1001);
      }
      expect(await claimOn(queues[0]!, buildId)).toBeNull();
      expect(await queues[2 % size]!.status(buildId)).toMatchObject({
        status: "failed",
        error: `boom ${String(RETRIES + 1)}`,
      });
    },
    timeoutMs,
  );

  it(
    "fails a job whose every attempt lost its lease",
    async () => {
      const { queues, advance, runId } = await fleet(makeDb, size);
      const buildId = `${runId}-hung`;
      await queues[0]!.enqueue({ buildId });
      for (let attempt = 1; attempt <= RETRIES + 1; attempt += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- attempts are sequential
        const job = await claimOn(queues[attempt % size]!, buildId);
        expect(job?.attempt).toBe(attempt);
        advance(LEASE_MS + 1);
      }
      expect(await claimOn(queues[0]!, buildId)).toBeNull();
      expect(await queues[1]!.status(buildId)).toMatchObject({
        status: "failed",
        error: LEASE_EXHAUSTED_ERROR,
      });
    },
    timeoutMs,
  );
}

function cancelAndKindCases(makeDb: SharedDatabaseFactory, size: number, timeoutMs?: number): void {
  it(
    "lets one instance cancel a job another instance holds",
    async () => {
      const { queues, runId } = await fleet(makeDb, size);
      const [holder, other] = [queues[0]!, queues[1]!];
      const buildId = `${runId}-cancel`;
      await other.enqueue({ buildId });
      const job = await claimOn(holder, buildId);
      expect(await holder.inspect(job!)).toBe("ok");
      expect(await other.cancel(buildId)).toBe(true);
      expect(await holder.inspect(job!)).toBe("cancelled");
      expect(await holder.extend(job!)).toBe("cancelled");
      await holder.nack(job!, { requeue: false, error: "cancelled" });
      expect((await other.status(buildId))?.status).toBe("cancelled");
      expect(await claimOn(other, buildId)).toBeNull();
    },
    timeoutMs,
  );

  it(
    "keeps job kinds independent",
    async () => {
      const shared = await makeDb();
      const reuse = (): DatabaseAdapter => shared;
      const capture = await fleet(reuse, 2, ["capture"]);
      const publish = await fleet(reuse, 2, ["publish"]);
      const buildId = `${capture.runId}-kinds`;
      await capture.queues[0]!.enqueue({ buildId });
      await publish.queues[0]!.enqueueJob({ kind: "publish", buildId, data: { zip: "k" } });
      const published = await claimOn(publish.queues[1]!, buildId);
      expect(published).toMatchObject({ kind: "publish", data: { zip: "k" } });
      const captured = await claimOn(capture.queues[1]!, buildId);
      expect(captured?.kind).toBe("capture");
      expect(await claimOn(publish.queues[0]!, buildId)).toBeNull();
      await publish.queues[1]!.ack(published!);
      await capture.queues[1]!.ack(captured!);
      expect((await capture.queues[0]!.status(buildId))?.status).toBe("completed");
    },
    timeoutMs,
  );
}
