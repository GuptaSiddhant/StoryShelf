import { describe, expect, it } from "vitest";
import { BuildModel } from "../../models/build.ts";
import { ProjectModel } from "../../models/project.ts";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { decodePayload } from "./codec.ts";
import { createDatabaseCaptureQueue } from "./index.ts";

function queue() {
  const { db } = makeDatabase();
  return { db, queue: createDatabaseCaptureQueue(db, { kinds: ["capture"] }) };
}

/** A promise the test settles by hand. */
function gate(): { promise: Promise<boolean>; resolve: (open: boolean) => void } {
  const holder: { resolve: (open: boolean) => void } = { resolve: () => {} };
  const promise = new Promise<boolean>((done) => {
    holder.resolve = done;
  });
  return { promise, resolve: (open) => holder.resolve(open) };
}

describe("database queue operations", () => {
  it("stamps the build with the job of its own run, not with a shard job", async () => {
    const { db, queue: q } = queue();
    const project = await new ProjectModel(db).create({ name: "P", gitRepository: "o/r" });
    const builds = new BuildModel(db);
    const build = await builds.create(project.id, { gitSha: "abc", gitBranch: "main" });
    await q.enqueue({ buildId: build.id, shard: "s1" });
    expect((await builds.get(build.id))?.captureJobId ?? null).toBeNull();

    await q.enqueue({ buildId: build.id });
    const own = (await q.active()).find((entry) => entry.shard === undefined);
    const job = await q.poll();
    expect(own).toBeDefined();
    expect((await builds.get(build.id))?.captureJobId).toBe(
      job?.shard === undefined ? job?.jobId : (await q.poll())?.jobId,
    );
  });

  it("keeps the newer run as owner when a slow enqueue is overtaken by a retry", async () => {
    const { db } = makeDatabase();
    const project = await new ProjectModel(db).create({ name: "P", gitRepository: "o/r" });
    const builds = new BuildModel(db);
    const build = await builds.create(project.id, { gitSha: "abc", gitBranch: "main" });
    // Hold the first enqueue between claiming the build and inserting its job row.
    const reached = gate();
    const release = gate();
    let held = false;
    const slow = Object.create(db) as typeof db;
    slow.insert = async (table, values) => {
      const row = await db.insert(table, values);
      if (table === db.tables.captureJobs && !held) {
        held = true;
        reached.resolve(true);
        await release.promise;
      }
      return row;
    };
    const q = createDatabaseCaptureQueue(slow, { kinds: ["capture"] });
    const first = q.enqueue({ buildId: build.id });
    await reached.promise;
    // A whole retry runs meanwhile: reset, then a new enqueue that stamps its job.
    await builds.resetStatus(build.id, "pending");
    await q.enqueue({ buildId: build.id });
    const newer = (await builds.get(build.id))?.captureJobId;
    expect(newer).toBeTruthy();

    release.resolve(true);
    await first;

    expect((await builds.get(build.id))?.captureJobId).toBe(newer);
    const entries = await q.recent(10);
    // The overtaken enqueue's job is queued, but it belongs to an older generation than the build:
    // its worker ends it before running (see capture-handler's `superseded`).
    expect(entries).toHaveLength(2);
    const rows = await db.list(db.tables.captureJobs);
    const generations = rows.map((row) => decodePayload(row.payload).data?.["generation"]);
    expect(generations).toContain(1);
    expect(generations).toContain(3);
    expect((await builds.get(build.id))?.captureGeneration).toBe(3);
  });

  it("lets only one of two concurrent enqueues of a build claim it", async () => {
    const { db } = makeDatabase();
    const project = await new ProjectModel(db).create({ name: "P", gitRepository: "o/r" });
    const builds = new BuildModel(db);
    const build = await builds.create(project.id, { gitSha: "abc", gitBranch: "main" });
    const q = createDatabaseCaptureQueue(db, { kinds: ["capture"] });

    await Promise.all([q.enqueue({ buildId: build.id }), q.enqueue({ buildId: build.id })]);

    const jobs = await db.list(db.tables.captureJobs);
    expect(jobs).toHaveLength(1);
    expect((await builds.get(build.id))?.captureJobId).toBe(jobs[0]?.jobId);
    expect((await builds.get(build.id))?.captureGeneration).toBe(1);
  });

  it("stores request id, trace and shard on the job row", async () => {
    const { queue: q } = queue();
    await q.enqueue({ buildId: "b1", reqId: "r", traceparent: "tp", shard: "s1" });
    const job = await q.poll();
    expect(job).toMatchObject({ buildId: "b1", reqId: "r", traceparent: "tp", shard: "s1" });
  });

  it("reports the build's own job, not its shards, as its status", async () => {
    const { db, queue: q } = queue();
    await q.enqueue({ buildId: "b1" });
    await q.enqueue({ buildId: "b1", shard: "s1" });
    // The build is missing, so nothing was claimed and the own job carries no generation.
    const own = (await db.list(db.tables.captureJobs)).find((row) => row.shardId === null);
    expect(decodePayload(own?.payload ?? null).data?.["generation"]).toBeUndefined();
    expect(await q.status("b1")).toMatchObject({ buildId: "b1", status: "queued" });
    expect((await q.status("b1"))?.shard).toBeUndefined();
    const shards = (await q.active()).map((entry) => entry.shard ?? "own");
    expect(new Set(shards)).toEqual(new Set(["own", "s1"]));
  });

  it("lets a job state its own attempts, and keeps notify jobs out of the views", async () => {
    const { db } = makeDatabase();
    const q = createDatabaseCaptureQueue(db, { kinds: ["capture", "notify"], retries: 2 });
    await q.enqueueJob({ kind: "capture", buildId: "b1" });
    await q.enqueueJob({ kind: "notify", buildId: "b1", maxAttempts: 5, data: { channelId: "c" } });
    expect((await q.active()).map((entry) => entry.buildId)).toEqual(["b1"]);
    expect(await q.recent(10)).toHaveLength(1);
    expect(await q.status("b1")).toMatchObject({ status: "queued" });
    const first = await q.poll();
    const second = await q.poll();
    const notify = [first, second].find((job) => job?.kind === "notify");
    expect(notify).toMatchObject({ maxAttempts: 5, data: { channelId: "c" } });
    expect([first, second].find((job) => job?.kind === "capture")?.maxAttempts).toBe(3);
  });

  it("shows notify jobs when they are the only kind polled", async () => {
    const { db } = makeDatabase();
    const q = createDatabaseCaptureQueue(db, { kinds: ["notify"] });
    await q.enqueueJob({ kind: "notify", buildId: "b1" });
    expect(await q.active()).toHaveLength(1);
  });

  it("returns the job id from enqueueJob and wakes a waiting poll", async () => {
    const { queue: q } = queue();
    const waiting = q.poll({ waitMs: 60_000 });
    const id = await q.enqueueJob({ kind: "capture", buildId: "b1" });
    expect((await waiting)?.jobId).toBe(id);
  });

  it("does not re-probe when a wait times out", async () => {
    const { queue: q } = queue();
    expect(await q.poll({ waitMs: 1 })).toBeNull();
    expect(await q.waitForWork(1)).toBe(false);
  });

  it("cancels by job id, any kind", async () => {
    const { db, queue: q } = queue();
    const other = createDatabaseCaptureQueue(db, { kinds: ["notify"] });
    const id = await other.enqueueJob({ kind: "notify" });
    expect(await q.cancel(id)).toBe(true);
    expect(await other.poll()).toBeNull();
    expect(await q.cancel(id)).toBe(false);
  });

  it("cancels every unfinished job of a build, shards included", async () => {
    const { queue: q } = queue();
    await q.enqueue({ buildId: "b1" });
    await q.enqueue({ buildId: "b1", shard: "s1" });
    const running = await q.poll();
    expect(await q.cancel("b1")).toBe(true);
    expect(await q.inspect(running!)).toBe("cancelled");
    expect(await q.poll()).toBeNull();
    const states = (await q.recent(10)).map((entry) => entry.status);
    expect(new Set(states)).toEqual(new Set(["cancelled", "running"]));
  });

  it("cancels the jobs of every kind of a build, whichever kinds the queue polls", async () => {
    const { db, queue: q } = queue();
    const publish = createDatabaseCaptureQueue(db, { kinds: ["publish"] });
    const notify = createDatabaseCaptureQueue(db, { kinds: ["notify"] });
    await publish.enqueueJob({ kind: "publish", buildId: "b1" });
    await notify.enqueueJob({ kind: "notify", buildId: "b1" });
    await notify.enqueueJob({ kind: "notify", buildId: "b2" });
    const running = await publish.poll();
    expect(await q.cancel("b1")).toBe(true);
    expect(await publish.inspect(running!)).toBe("cancelled");
    expect(await notify.poll()).toMatchObject({ buildId: "b2" });
    expect(await notify.poll()).toBeNull();
  });

  it("leaves finished jobs of a build alone", async () => {
    const { db, queue: q } = queue();
    const publish = createDatabaseCaptureQueue(db, { kinds: ["publish"] });
    await publish.enqueueJob({ kind: "publish", buildId: "b1" });
    await publish.ack((await publish.poll())!);
    await q.enqueue({ buildId: "b1" });
    await q.ack((await q.poll())!);
    expect(await q.cancel("b1")).toBe(false);
  });

  it("flags an attempt a claimer inserted while a queued job was being cancelled", async () => {
    const { db, queue: q } = queue();
    await q.enqueue({ buildId: "b1" });
    const [row] = await db.list(db.tables.captureJobs);
    const job = row as { id: string; jobId: string };
    // A claim that inserted attempt 1 but has not marked the job running yet.
    await db.insert(db.tables.captureJobs, {
      ...(row as object),
      id: `${job.jobId}:1`,
      entry: "attempt",
      attempt: 1,
      status: "running",
    } as never);
    await q.cancel("b1");
    const attempt = (await db.get(db.tables.captureJobs, `${job.jobId}:1`)) as {
      cancelRequestedAt: string | null;
    };
    expect(attempt.cancelRequestedAt).not.toBeNull();
  });
});
