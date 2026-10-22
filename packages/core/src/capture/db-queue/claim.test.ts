import { describe, expect, it, vi } from "vitest";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { claimCandidate, claimNext, LEASE_EXHAUSTED_ERROR } from "./claim.ts";
import type { QueueRuntime } from "./types.ts";
import { createWakeSignal } from "./wake.ts";

function runtime(owner = "me"): { rt: QueueRuntime; clock: { now: number } } {
  const { db } = makeDatabase();
  const clock = { now: Date.parse("2026-01-01T00:00:00.000Z") };
  const rt: QueueRuntime = {
    model: new CaptureJobModel(db),
    kinds: ["capture"],
    leaseMs: 1000,
    maxAttempts: 2,
    owner,
    now: () => clock.now,
    wake: createWakeSignal(),
    pollVersion: 0,
  };
  return { rt, clock };
}

function peer(rt: QueueRuntime, owner: string): QueueRuntime {
  return { ...rt, owner };
}

const iso = (ms: number): string => new Date(ms).toISOString();

async function enqueue(rt: QueueRuntime, id = "j1"): Promise<void> {
  await rt.model.create({ id, kind: "capture", buildId: "b1", maxAttempts: 2 }, iso(rt.now()));
}

describe("claimNext", () => {
  it("returns null on an empty queue", async () => {
    const { rt } = runtime();
    expect(await claimNext(rt)).toBeNull();
  });

  it("claims attempt 1, records the owner and lease, and marks the job running", async () => {
    const { rt } = runtime();
    await enqueue(rt);
    const job = await claimNext(rt);
    expect(job).toMatchObject({ jobId: "j1", attempt: 1, receipt: "j1:1", leaseMs: 1000 });
    expect(await rt.model.get("j1:1")).toMatchObject({
      owner: "me",
      status: "running",
      visibleAt: iso(rt.now() + 1000),
    });
    expect(await rt.model.get("j1")).toMatchObject({
      status: "running",
      attempt: 1,
      visibleAt: null,
    });
  });

  it("takes over an expired lease and retires the old attempt", async () => {
    const { rt, clock } = runtime();
    await enqueue(rt);
    await claimNext(rt);
    clock.now += 1001;
    const job = await claimNext(peer(rt, "other"));
    expect(job?.attempt).toBe(2);
    expect(await rt.model.get("j1:1")).toMatchObject({ status: "expired", visibleAt: null });
    expect(await rt.model.get("j1:2")).toMatchObject({ owner: "other", status: "running" });
  });

  it("fails the job when the final attempt's lease expires", async () => {
    const { rt, clock } = runtime();
    await enqueue(rt);
    await claimNext(rt);
    clock.now += 1001;
    await claimNext(rt);
    clock.now += 1001;
    expect(await claimNext(rt)).toBeNull();
    expect(await rt.model.get("j1")).toMatchObject({
      status: "failed",
      error: LEASE_EXHAUSTED_ERROR,
    });
    expect((await rt.model.get("j1:2"))?.status).toBe("expired");
  });

  it("tells the host when a job is failed by an exhausted lease, and survives the hook throwing", async () => {
    const { rt, clock } = runtime();
    const onExhausted = vi.fn(async () => {});
    rt.onExhausted = onExhausted;
    await enqueue(rt);
    await claimNext(rt);
    clock.now += 1001;
    await claimNext(rt);
    clock.now += 1001;
    await claimNext(rt);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(onExhausted).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j1", kind: "capture", buildId: "b1" }),
      LEASE_EXHAUSTED_ERROR,
    );

    await enqueue(rt, "j2");
    rt.onExhausted = async () => {
      await Promise.resolve();
      throw new Error("hook broke");
    };
    await claimNext(rt);
    clock.now += 1001;
    await claimNext(rt);
    clock.now += 1001;
    expect(await claimNext(rt)).toBeNull();
    expect((await rt.model.get("j2"))?.status).toBe("failed");
  });

  it("does not tell the host about a job a late holder finished", async () => {
    const { rt, clock } = runtime();
    const onExhausted = vi.fn(async () => {});
    rt.onExhausted = onExhausted;
    await enqueue(rt);
    await claimNext(rt);
    clock.now += 1001;
    await claimNext(rt);
    clock.now += 1001;
    const stale = (await rt.model.nextCandidate(["capture"], iso(clock.now)))!;
    await rt.model.finishAttempt("j1:2", "done", iso(clock.now));
    await claimCandidate(rt, stale);
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("lets a late finisher of the final attempt win over exhaustion", async () => {
    const { rt, clock } = runtime();
    await enqueue(rt);
    await claimNext(rt);
    clock.now += 1001;
    await claimNext(rt);
    clock.now += 1001;
    const stale = (await rt.model.nextCandidate(["capture"], iso(clock.now)))!;
    await rt.model.finishAttempt("j1:2", "done", iso(clock.now));
    expect(await claimCandidate(rt, stale)).toBeNull();
    expect((await rt.model.get("j1"))?.status).toBe("done");
  });

  it("only cleans up an expired attempt whose job already ended or moved on", async () => {
    const { rt, clock } = runtime();
    await enqueue(rt);
    await claimNext(rt);
    clock.now += 1001;
    const expired = (await rt.model.nextCandidate(["capture"], iso(clock.now)))!;
    await rt.model.finishJob("j1", "done", iso(clock.now));
    expect(await claimCandidate(rt, expired)).toBeNull();
    expect((await rt.model.get("j1:1"))?.status).toBe("expired");
    expect(await rt.model.get("j1:2")).toBeNull();
  });

  it("retires an attempt superseded by a later one", async () => {
    const { rt } = runtime();
    await enqueue(rt);
    await claimNext(rt);
    await rt.model.markRunning("j1", 2, iso(rt.now()));
    const old = (await rt.model.get("j1:1"))!;
    expect(await claimCandidate(rt, old)).toBeNull();
    expect((await rt.model.get("j1:1"))?.status).toBe("expired");
  });

  it("retires an attempt whose job row vanished", async () => {
    const { rt } = runtime();
    await enqueue(rt);
    await claimNext(rt);
    const attempt = (await rt.model.get("j1:1"))!;
    await rt.model.purgeFinished("9999");
    await rt.model.finishJob("j1", "done", iso(rt.now()));
    expect(await claimCandidate(rt, { ...attempt, jobId: "gone" })).toBeNull();
  });

  it("gives the claim back when the job was cancelled during the race", async () => {
    const { rt } = runtime();
    await enqueue(rt);
    const candidate = (await rt.model.get("j1"))!;
    await rt.model.finishJob("j1", "cancelled", iso(rt.now()));
    expect(await claimCandidate(rt, candidate)).toBeNull();
    expect((await rt.model.get("j1:1"))?.status).toBe("expired");
    expect((await rt.model.get("j1"))?.status).toBe("cancelled");
  });

  it("moves on to the next candidate after losing a race", async () => {
    const { rt } = runtime();
    await enqueue(rt, "j1");
    await enqueue(rt, "j2");
    // Another instance already inserted attempt 1 of j1 but has not marked the job yet.
    const j1 = (await rt.model.get("j1"))!;
    await rt.model.claim(
      { job: j1, attempt: 1, owner: "rival", leaseUntil: iso(rt.now() + 1000) },
      iso(rt.now()),
    );
    const job = await claimNext(rt);
    expect(job?.jobId).toBe("j2");
  });

  it("moves a job behind a dead winner's lease, then claims the expired attempt", async () => {
    const { rt, clock } = runtime();
    await enqueue(rt, "j1");
    await enqueue(rt, "j2");
    const j1 = (await rt.model.get("j1"))!;
    // The winner of attempt 1 died between its insert and marking the job running.
    await rt.model.claim(
      { job: j1, attempt: 1, owner: "dead", leaseUntil: iso(rt.now() + 1000) },
      iso(rt.now()),
    );
    // The head of the queue no longer blocks the next job.
    expect((await claimNext(rt))?.jobId).toBe("j2");
    expect(await rt.model.get("j1")).toMatchObject({
      status: "queued",
      visibleAt: iso(rt.now() + 1000),
    });
    expect(await claimNext(rt)).toBeNull();
    clock.now += 1000;
    const job = await claimNext(rt);
    expect(job).toMatchObject({ jobId: "j1", attempt: 2 });
    expect((await rt.model.get("j1:1"))?.status).toBe("expired");
    expect(await rt.model.get("j1")).toMatchObject({
      status: "running",
      attempt: 2,
      visibleAt: null,
    });
  });

  it("never overwrites the outcome of a winner that finished during the race", async () => {
    const { rt } = runtime();
    await enqueue(rt);
    const candidate = (await rt.model.get("j1"))!;
    const winner = await claimNext(peer(rt, "winner"));
    await rt.model.finishAttempt(winner!.receipt!, "done", iso(rt.now()));
    await rt.model.finishJob("j1", "done", iso(rt.now()));
    expect(await claimCandidate(rt, candidate)).toBeNull();
    expect((await rt.model.get("j1"))?.status).toBe("done");
  });

  it("clears a running job row that a late deferral put back in range", async () => {
    const { rt } = runtime();
    await enqueue(rt);
    await claimNext(rt);
    await rt.model.defer("j1", iso(rt.now()), iso(rt.now()));
    expect(await claimNext(peer(rt, "other"))).toBeNull();
    expect(await rt.model.get("j1")).toMatchObject({ status: "running", visibleAt: null });
  });

  it("claims past an attempt row that is ahead of its job row", async () => {
    const { rt, clock } = runtime();
    await enqueue(rt);
    const j1 = (await rt.model.get("j1"))!;
    // The claimer of attempt 1 died between its insert and marking the job; nobody repaired it.
    await rt.model.claim(
      { job: j1, attempt: 1, owner: "dead", leaseUntil: iso(rt.now() + 1000) },
      iso(rt.now()),
    );
    await rt.model.markRunning("j1", 0, iso(rt.now()));
    clock.now += 1001;
    expect((await claimNext(rt))?.attempt).toBe(2);
  });

  it("gives up after a few lost races", async () => {
    const { rt } = runtime();
    await enqueue(rt);
    const real = rt.model;
    const model = {
      nextCandidate: real.nextCandidate.bind(real),
      get: real.get.bind(real),
      claim: async () => false,
      expiredAttempt: async () => null,
      defer: async () => {},
    };
    expect(await claimNext({ ...rt, model: model as never })).toBeNull();
    expect((await rt.model.get("j1"))?.status).toBe("queued");
  });
});
