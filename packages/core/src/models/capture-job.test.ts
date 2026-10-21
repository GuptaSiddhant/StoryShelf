import { describe, expect, it } from "vitest";
import { makeDatabase } from "../test-helpers/fake-database.ts";
import { attemptRowId, CaptureJobModel, isTerminalJob, parseAttemptRowId } from "./capture-job.ts";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";
const T2 = "2026-01-01T00:00:02.000Z";

function model() {
  const { db } = makeDatabase();
  return { db, jobs: new CaptureJobModel(db) };
}

async function queued(jobs: CaptureJobModel, id = "j1", extra = {}) {
  return await jobs.create({ id, kind: "capture", buildId: "b1", maxAttempts: 3, ...extra }, T0);
}

describe("CaptureJobModel", () => {
  it("creates a queued job row visible from now", async () => {
    const { jobs } = model();
    const row = await queued(jobs, "j1", { payload: '{"reqId":"r"}' });
    expect(row).toMatchObject({
      id: "j1",
      entry: "job",
      jobId: "j1",
      kind: "capture",
      buildId: "b1",
      shardId: null,
      attempt: 0,
      maxAttempts: 3,
      status: "queued",
      visibleAt: T0,
      payload: '{"reqId":"r"}',
      createdAt: T0,
    });
    expect(await jobs.get("j1")).toEqual(row);
    expect(await jobs.get("missing")).toBeNull();
  });

  it("honours an explicit visibility time", async () => {
    const { jobs } = model();
    await queued(jobs, "j1", { visibleAt: T2 });
    expect(await jobs.nextCandidate(["capture"], T1)).toBeNull();
    expect((await jobs.nextCandidate(["capture"], T2))?.id).toBe("j1");
  });

  it("finds the oldest visible candidate of the given kinds", async () => {
    const { jobs } = model();
    await jobs.create({ id: "late", kind: "capture", maxAttempts: 1, visibleAt: T1 }, T0);
    await jobs.create({ id: "early", kind: "capture", maxAttempts: 1, visibleAt: T0 }, T0);
    await jobs.create({ id: "other", kind: "notify", maxAttempts: 1 }, T0);
    expect((await jobs.nextCandidate(["capture"], T2))?.id).toBe("early");
    expect((await jobs.nextCandidate(["notify"], T2))?.id).toBe("other");
    expect((await jobs.nextCandidate(["publish", "notify"], T2))?.id).toBe("other");
    expect(await jobs.nextCandidate(["publish"], T2)).toBeNull();
  });

  it("lets exactly one claim of an attempt win and rethrows real failures", async () => {
    const { db, jobs } = model();
    const job = await queued(jobs);
    const claim = { job, attempt: 1, owner: "a", leaseUntil: T2 };
    const results = await Promise.all([
      jobs.claim(claim, T0),
      jobs.claim({ ...claim, owner: "b" }, T0),
      jobs.claim({ ...claim, owner: "c" }, T0),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const attempt = await jobs.get(attemptRowId("j1", 1));
    expect(attempt).toMatchObject({
      entry: "attempt",
      jobId: "j1",
      status: "running",
      visibleAt: T2,
    });
    const broken = new CaptureJobModel({
      ...db,
      insert: async () => {
        throw new Error("disk full");
      },
    });
    await expect(broken.claim({ ...claim, attempt: 2 }, T0)).rejects.toThrow("disk full");
  });

  it("makes a running attempt the candidate once its lease passes", async () => {
    const { jobs } = model();
    const job = await queued(jobs);
    await jobs.claim({ job, attempt: 1, owner: "a", leaseUntil: T1 }, T0);
    await jobs.markRunning("j1", 1, T0);
    expect(await jobs.get("j1")).toMatchObject({ status: "running", attempt: 1, visibleAt: null });
    expect(await jobs.nextCandidate(["capture"], T0)).toBeNull();
    expect((await jobs.nextCandidate(["capture"], T1))?.id).toBe("j1:1");
    const renewed = await jobs.renew("j1:1", T2, T1);
    expect(renewed?.visibleAt).toBe(T2);
    expect(await jobs.nextCandidate(["capture"], T1)).toBeNull();
  });

  it("finishes attempts and jobs out of the poll's range", async () => {
    const { jobs } = model();
    const job = await queued(jobs);
    await jobs.claim({ job, attempt: 1, owner: "a", leaseUntil: T1 }, T0);
    await jobs.finishAttempt("j1:1", "failed", T1, "boom");
    expect(await jobs.get("j1:1")).toMatchObject({
      status: "failed",
      error: "boom",
      visibleAt: null,
    });
    await jobs.finishJob("j1", "failed", T1, "boom");
    expect(await jobs.get("j1")).toMatchObject({ status: "failed", error: "boom", finishedAt: T1 });
    await jobs.finishJob("j1", "done", T2);
    expect(await jobs.get("j1")).toMatchObject({ status: "done", error: "boom" });
    expect(await jobs.nextCandidate(["capture"], T2)).toBeNull();
  });

  it("requeues with a delay and the error, and clears a stray lease", async () => {
    const { jobs } = model();
    const job = await queued(jobs);
    await jobs.markRunning("j1", 1, T0);
    await jobs.requeue("j1", T2, "flaky", T0);
    expect(await jobs.get("j1")).toMatchObject({ status: "queued", visibleAt: T2, error: "flaky" });
    await jobs.claim({ job, attempt: 2, owner: "a", leaseUntil: T1 }, T0);
    await jobs.clearVisibility("j1:2", T0);
    expect(await jobs.get("j1:2")).toMatchObject({ status: "running", visibleAt: null });
  });

  it("finds an attempt only once its lease passed, and moves visibility alone", async () => {
    const { jobs } = model();
    const job = await queued(jobs);
    await jobs.claim({ job, attempt: 1, owner: "a", leaseUntil: T1 }, T0);
    expect(await jobs.expiredAttempt("j1:1", T0)).toBeNull();
    expect((await jobs.expiredAttempt("j1:1", T1))?.id).toBe("j1:1");
    await jobs.finishAttempt("j1:1", "done", T1);
    expect(await jobs.expiredAttempt("j1:1", T2)).toBeNull();
    await jobs.defer("j1", T2, T1);
    expect(await jobs.get("j1")).toMatchObject({ status: "queued", visibleAt: T2 });
  });

  it("flags cancel permanently", async () => {
    const { jobs } = model();
    await queued(jobs);
    await jobs.flagCancel("j1", T1);
    await jobs.markRunning("j1", 1, T2);
    expect((await jobs.get("j1"))?.cancelRequestedAt).toBe(T1);
  });

  it("copies a cancel flag onto a new attempt row", async () => {
    const { jobs } = model();
    await queued(jobs);
    await jobs.flagCancel("j1", T1);
    const job = (await jobs.get("j1"))!;
    await jobs.claim({ job, attempt: 1, owner: "a", leaseUntil: T2 }, T1);
    expect((await jobs.get("j1:1"))?.cancelRequestedAt).toBe(T1);
  });

  it("lists a build's jobs and its latest own job per kind", async () => {
    const { jobs } = model();
    await jobs.create({ id: "a", kind: "capture", buildId: "b1", maxAttempts: 1 }, T0);
    await jobs.create(
      { id: "s", kind: "capture", buildId: "b1", shardId: "sh", maxAttempts: 1 },
      T1,
    );
    await jobs.create({ id: "p", kind: "publish", buildId: "b1", maxAttempts: 1 }, T2);
    await jobs.create({ id: "x", kind: "capture", buildId: "b2", maxAttempts: 1 }, T2);
    const job = (await jobs.get("a"))!;
    await jobs.claim({ job, attempt: 1, owner: "o", leaseUntil: T2 }, T0);
    expect((await jobs.listForBuild("b1")).map((row) => row.id)).toEqual(["a", "s", "p"]);
    expect((await jobs.latestForBuild("b1", ["capture"]))?.id).toBe("a");
    expect((await jobs.latestForBuild("b1", ["publish"]))?.id).toBe("p");
    expect(await jobs.latestForBuild("b3", ["capture"])).toBeNull();
    expect((await jobs.attempts("a")).map((row) => row.id)).toEqual(["a:1"]);
  });

  it("lists active and recent jobs of the given kinds", async () => {
    const { jobs } = model();
    await jobs.create({ id: "q", kind: "capture", maxAttempts: 1 }, T0);
    await jobs.create({ id: "r", kind: "capture", maxAttempts: 1 }, T1);
    await jobs.create({ id: "d", kind: "capture", maxAttempts: 1 }, T2);
    await jobs.create({ id: "n", kind: "notify", maxAttempts: 1 }, T2);
    await jobs.markRunning("r", 1, T1);
    await jobs.finishJob("d", "done", T2);
    expect((await jobs.listActive(["capture"])).map((row) => row.id)).toEqual(["q", "r"]);
    expect((await jobs.listRecent(["capture"], 2)).map((row) => row.id)).toEqual(["d", "r"]);
    expect((await jobs.listRecent(["capture", "notify"], 10)).map((row) => row.id)).toEqual([
      "n",
      "d",
      "r",
      "q",
    ]);
  });

  it("purges finished jobs older than the cutoff with their attempts", async () => {
    const { jobs } = model();
    const old = await jobs.create({ id: "old", kind: "capture", maxAttempts: 1 }, T0);
    await jobs.claim({ job: old, attempt: 1, owner: "o", leaseUntil: T1 }, T0);
    await jobs.finishJob("old", "done", T1);
    await jobs.create({ id: "running", kind: "capture", maxAttempts: 1 }, T0);
    await jobs.create({ id: "new", kind: "capture", maxAttempts: 1 }, T2);
    await jobs.finishJob("new", "failed", T2);
    expect(await jobs.purgeFinished(T1)).toBe(1);
    expect(await jobs.get("old")).toBeNull();
    expect(await jobs.get("old:1")).toBeNull();
    expect(await jobs.get("running")).not.toBeNull();
    expect(await jobs.get("new")).not.toBeNull();
  });

  it("uses the tables it was given", async () => {
    const { db } = makeDatabase();
    const jobs = new CaptureJobModel(db, { captureJobs: db.tables.captureJobs });
    await queued(jobs);
    expect((await db.get(db.tables.captureJobs, "j1")) !== null).toBe(true);
  });
});

describe("attempt row ids", () => {
  it("round-trips job id and attempt number", () => {
    expect(attemptRowId("01JOB", 2)).toBe("01JOB:2");
    expect(parseAttemptRowId("01JOB:2")).toEqual({ jobId: "01JOB", attempt: 2 });
  });

  it("rejects ids that are not attempt rows", () => {
    for (const bad of ["01JOB", ":1", "01JOB:0", "01JOB:x", "01JOB:1.5"]) {
      expect(parseAttemptRowId(bad)).toBeNull();
    }
  });

  it("knows which job statuses are terminal", () => {
    const row = { status: "queued" } as never;
    expect(isTerminalJob(row)).toBe(false);
    for (const status of ["done", "failed", "cancelled"]) {
      expect(isTerminalJob({ status } as never)).toBe(true);
    }
  });
});
