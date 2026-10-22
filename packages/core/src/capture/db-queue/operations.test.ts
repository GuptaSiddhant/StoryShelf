import { describe, expect, it } from "vitest";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { createDatabaseCaptureQueue } from "./index.ts";

function queue() {
  const { db } = makeDatabase();
  return { db, queue: createDatabaseCaptureQueue(db, { kinds: ["capture"] }) };
}

describe("database queue operations", () => {
  it("stores request id, trace and shard on the job row", async () => {
    const { queue: q } = queue();
    await q.enqueue({ buildId: "b1", reqId: "r", traceparent: "tp", shard: "s1" });
    const job = await q.poll();
    expect(job).toMatchObject({ buildId: "b1", reqId: "r", traceparent: "tp", shard: "s1" });
  });

  it("reports the build's own job, not its shards, as its status", async () => {
    const { queue: q } = queue();
    await q.enqueue({ buildId: "b1" });
    await q.enqueue({ buildId: "b1", shard: "s1" });
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

  it("leaves finished jobs and other kinds of a build alone", async () => {
    const { db, queue: q } = queue();
    const publish = createDatabaseCaptureQueue(db, { kinds: ["publish"] });
    await publish.enqueueJob({ kind: "publish", buildId: "b1" });
    await q.enqueue({ buildId: "b1" });
    await q.ack((await q.poll())!);
    expect(await q.cancel("b1")).toBe(false);
    expect((await publish.poll())?.kind).toBe("publish");
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
