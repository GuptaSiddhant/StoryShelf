import { describe, expect, it, vi } from "vitest";
import type { CaptureJob, CaptureQueue, QueueEntry } from "../../adapters/capture-queue.ts";
import { FakeChild } from "../../test-helpers/fake-child.ts";
import { queueContractSuite } from "../../test-helpers/queue-contract.ts";
import { ForkedCaptureQueue, type ForkedCaptureQueueOptions } from "./forked-queue.ts";

const tick = async (ms = 0): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/** A spawn that hands out fresh fake children and remembers them. */
function spawner() {
  const children: FakeChild[] = [];
  const spawn = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  return { spawn, children, last: (): FakeChild => children.at(-1) as FakeChild };
}

function fakeFallback() {
  const jobs: CaptureJob[] = [];
  const entries = new Map<string, QueueEntry>();
  const fallback = {
    metadata: { name: "fb", version: "0", kind: "memory", category: "capture-queue" },
    enqueue: vi.fn(async (job: CaptureJob) => {
      jobs.push(job);
      entries.set(job.buildId, {
        buildId: job.buildId,
        status: "running",
        queuedAt: new Date().toISOString(),
      });
      await Promise.resolve();
    }),
    status: vi.fn(async (id: string) => entries.get(id) ?? null),
    active: vi.fn(async () => [...entries.values()]),
    recent: vi.fn(async () => [...entries.values()]),
  } as unknown as CaptureQueue;
  return { fallback, jobs };
}

function make(overrides: Partial<ForkedCaptureQueueOptions> = {}) {
  const spawned = spawner();
  const queue = new ForkedCaptureQueue({ spawn: spawned.spawn, restartDelayMs: 1, ...overrides });
  return { queue, ...spawned };
}

describe("ForkedCaptureQueue delivery", () => {
  it("starts the child lazily on the first enqueue and only once", async () => {
    const { queue, spawn } = make();
    expect(spawn).not.toHaveBeenCalled();
    await queue.enqueue({ buildId: "b1" });
    await queue.enqueue({ buildId: "b2" });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("delivers a job to a polling child with a receipt, then completes it on ack", async () => {
    const onSettled = vi.fn(async () => {});
    const { queue, last } = make({ onSettled });
    await queue.enqueue({ buildId: "b1", reqId: "req-1" });
    expect((await queue.status("b1"))?.status).toBe("queued");

    last().say({ type: "poll", id: 7, waitMs: 1000 });
    const [delivery] = last().delivered();
    expect(delivery).toMatchObject({ id: 7, job: { buildId: "b1", reqId: "req-1", attempts: 0 } });
    expect(delivery?.job.receipt).toBeTruthy();
    expect((await queue.status("b1"))?.status).toBe("running");

    last().say({ type: "ack", receipt: delivery?.job.receipt });
    const entry = await queue.status("b1");
    expect(entry?.status).toBe("completed");
    expect(entry?.finishedAt).toBeTruthy();
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ buildId: "b1" }), {
      status: "completed",
    });
  });

  it("holds a poll until a job arrives, then answers it", async () => {
    const { queue, last } = make();
    await queue.enqueue({ buildId: "warm" });
    last().say({ type: "poll", id: 1, waitMs: 1000 }); // takes "warm"
    last().say({ type: "poll", id: 2, waitMs: 1000 }); // nothing pending: held
    expect(last().delivered()).toHaveLength(1);
    await queue.enqueue({ buildId: "b2" });
    expect(
      last()
        .delivered()
        .map((m) => m.job.buildId),
    ).toEqual(["warm", "b2"]);
    expect(last().delivered()[1]?.id).toBe(2);
  });

  it("answers an unanswered poll with empty after its wait", async () => {
    const { queue, last } = make();
    await queue.enqueue({ buildId: "b1" });
    last().say({ type: "poll", id: 1, waitMs: 1000 });
    last().say({ type: "poll", id: 2, waitMs: 10 });
    await tick(40);
    expect(last().sent).toContainEqual({ type: "empty", id: 2 });
  });

  it("delivers jobs in order to concurrent polls", async () => {
    const { queue, last } = make();
    await queue.enqueue({ buildId: "a" });
    await queue.enqueue({ buildId: "b" });
    last().say({ type: "poll", id: 1, waitMs: 1000 });
    last().say({ type: "poll", id: 2, waitMs: 1000 });
    expect(
      last()
        .delivered()
        .map((m) => m.job.buildId),
    ).toEqual(["a", "b"]);
    const receipts = last()
      .delivered()
      .map((m) => m.job.receipt);
    expect(new Set(receipts).size).toBe(2);
  });

  it("ignores malformed messages and unknown receipts", async () => {
    const { queue, last } = make();
    await queue.enqueue({ buildId: "b1" });
    last().say({ nonsense: true });
    last().say({ type: "ack", receipt: "does-not-exist" });
    last().say({ type: "nack", receipt: "nope", requeue: true });
    expect((await queue.status("b1"))?.status).toBe("queued");
  });

  it("accepts an enqueue sent by the child", async () => {
    const { queue, last } = make();
    await queue.enqueue({ buildId: "b1" });
    last().say({ type: "enqueue", job: { buildId: "from-child" } });
    expect((await queue.status("from-child"))?.status).toBe("queued");
  });
});

describe("ForkedCaptureQueue shards", () => {
  it("tracks each shard of a build beside the build and delivers it with its shard", async () => {
    const { queue, last } = make();
    await queue.enqueue({ buildId: "b1" });
    last().say({ type: "enqueue", job: { buildId: "b1", shard: "b1:render:1" } });
    last().say({ type: "enqueue", job: { buildId: "b1", shard: "b1:render:2" } });

    last().say({ type: "poll", id: 1, waitMs: 1000 });
    last().say({ type: "poll", id: 2, waitMs: 1000 });
    last().say({ type: "poll", id: 3, waitMs: 1000 });

    const jobs = last()
      .delivered()
      .map((delivery) => delivery.job);
    expect(jobs.map((job) => job.shard)).toEqual([undefined, "b1:render:1", "b1:render:2"]);
    // Three jobs for one build never collapse into one entry.
    expect(new Set(jobs.map((job) => job.receipt)).size).toBe(3);
    expect((await queue.status("b1"))?.shard).toBeUndefined();
  });

  it("settles one shard without finishing its siblings", async () => {
    const onSettled = vi.fn(async () => {});
    const { queue, last } = make({ onSettled });
    await queue.enqueue({ buildId: "b1", shard: "b1:render:1" });
    await queue.enqueue({ buildId: "b1", shard: "b1:render:2" });
    last().say({ type: "poll", id: 1, waitMs: 1000 });
    last().say({ type: "poll", id: 2, waitMs: 1000 });
    const [first, second] = last().delivered();

    last().say({ type: "ack", receipt: first?.job.receipt });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(
      expect.objectContaining({ shard: "b1:render:1" }),
      expect.anything(),
    );
    last().say({ type: "ack", receipt: second?.job.receipt });
    expect(onSettled).toHaveBeenCalledTimes(2);
  });

  it("redelivers a shard whose child crashed, still a shard", async () => {
    const { queue, last, children } = make();
    await queue.enqueue({ buildId: "b1", shard: "b1:render:1" });
    last().say({ type: "poll", id: 1, waitMs: 1000 });
    last().exit(1);
    await tick(20);

    const restarted = children.at(-1) as FakeChild;
    restarted.say({ type: "poll", id: 1, waitMs: 1000 });
    expect(restarted.delivered()[0]?.job).toMatchObject({
      buildId: "b1",
      shard: "b1:render:1",
      attempts: 1,
    });
  });
});

describe("ForkedCaptureQueue nack", () => {
  it("redelivers a requeued job with attempts bumped, after the delay", async () => {
    const { queue, last } = make();
    await queue.enqueue({ buildId: "b1" });
    last().say({ type: "poll", id: 1, waitMs: 1000 });
    const first = last().delivered()[0]?.job;
    last().say({ type: "nack", receipt: first?.receipt, requeue: true, delayMs: 15 });
    expect((await queue.status("b1"))?.status).toBe("running");
    await tick(40);
    expect((await queue.status("b1"))?.status).toBe("queued");
    last().say({ type: "poll", id: 2, waitMs: 1000 });
    const second = last().delivered()[1]?.job;
    expect(second?.attempts).toBe(1);
    expect(second?.receipt).not.toBe(first?.receipt);
  });

  it("fails a job nacked without requeue and reports it", async () => {
    const onSettled = vi.fn(async () => {});
    const { queue, last } = make({ onSettled });
    await queue.enqueue({ buildId: "b1" });
    last().say({ type: "poll", id: 1, waitMs: 1000 });
    last().say({
      type: "nack",
      receipt: last().delivered()[0]?.job.receipt,
      requeue: false,
      error: "boom",
    });
    const entry = await queue.status("b1");
    expect(entry).toMatchObject({ status: "failed", error: "boom" });
    expect(onSettled).toHaveBeenCalledWith(expect.anything(), { status: "failed", error: "boom" });
  });

  it("keeps going when the settle hook throws", async () => {
    const { queue, last } = make({
      onSettled: async () => {
        throw new Error("hook broke");
      },
    });
    await queue.enqueue({ buildId: "b1" });
    last().say({ type: "poll", id: 1, waitMs: 1000 });
    last().say({ type: "ack", receipt: last().delivered()[0]?.job.receipt });
    await tick();
    expect((await queue.status("b1"))?.status).toBe("completed");
  });
});

describe("ForkedCaptureQueue crash handling", () => {
  it("requeues in-flight jobs when the child dies and restarts it", async () => {
    const { queue, children } = make();
    await queue.enqueue({ buildId: "b1" });
    children[0]?.say({ type: "poll", id: 1, waitMs: 1000 });
    const original = children[0]?.delivered()[0]?.job;
    children[0]?.exit(1);

    expect((await queue.status("b1"))?.status).toBe("queued");
    await tick(20);
    expect(children).toHaveLength(2);
    children[1]?.say({ type: "poll", id: 1, waitMs: 1000 });
    const redelivered = children[1]?.delivered()[0]?.job;
    expect(redelivered).toMatchObject({ buildId: "b1", attempts: 1 });
    expect(redelivered?.receipt).not.toBe(original?.receipt);
  });

  it("ignores an ack from a dead child's old receipt", async () => {
    const { queue, children } = make();
    await queue.enqueue({ buildId: "b1" });
    children[0]?.say({ type: "poll", id: 1, waitMs: 1000 });
    const stale = children[0]?.delivered()[0]?.job.receipt;
    children[0]?.exit(1);
    await tick(20);
    children[1]?.say({ type: "ack", receipt: stale });
    expect((await queue.status("b1"))?.status).toBe("queued");
  });

  it("fails a job after it has crashed the child more than maxCrashRetries times", async () => {
    const onSettled = vi.fn(async () => {});
    const { queue, children } = make({ maxCrashRetries: 1, crashLimit: 10, onSettled });
    await queue.enqueue({ buildId: "poison" });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const child = children.at(-1) as FakeChild;
      child.say({ type: "poll", id: 1, waitMs: 1000 });
      child.exit(1);
      // oxlint-disable-next-line eslint/no-await-in-loop -- waits out the restart delay
      await tick(20);
    }
    const entry = await queue.status("poison");
    expect(entry?.status).toBe("failed");
    expect(entry?.error).toMatch(/exited \(code 1\) 2 times/u);
    expect(onSettled).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("does not restart after a clean exit with nothing left to do", async () => {
    const { queue, children } = make();
    await queue.enqueue({ buildId: "b1" });
    children[0]?.say({ type: "poll", id: 1, waitMs: 1000 });
    children[0]?.say({ type: "ack", receipt: children[0]?.delivered()[0]?.job.receipt });
    children[0]?.exit(0);
    await tick(20);
    expect(children).toHaveLength(1);
  });

  it("describes a signal exit", async () => {
    const { queue, children } = make({ maxCrashRetries: 0 });
    await queue.enqueue({ buildId: "b1" });
    children[0]?.say({ type: "poll", id: 1, waitMs: 1000 });
    children[0]?.exit(null, "SIGKILL");
    expect((await queue.status("b1"))?.error).toMatch(/signal SIGKILL/u);
  });
});

async function deliverOne(leaseMs: number, overrides: Partial<ForkedCaptureQueueOptions> = {}) {
  const made = make({ leaseMs, ...overrides });
  await made.queue.enqueue({ buildId: "b1" });
  made.last().say({ type: "poll", id: 1, waitMs: 1000 });
  return { ...made, receipt: made.last().delivered()[0]?.job.receipt };
}

describe("ForkedCaptureQueue hang detection", () => {
  it("force-kills a child whose job makes no progress, then treats it as a crash", async () => {
    const { queue, children } = await deliverOne(30);
    await tick(80);
    expect(children[0]?.killed).toBe(true);
    expect(children[0]?.forced).toBe(true);

    children[0]?.exit(null, "SIGKILL"); // what the real kill produces
    expect((await queue.status("b1"))?.status).toBe("queued");
    await tick(20);
    expect(children).toHaveLength(2);
    children[1]?.say({ type: "poll", id: 1, waitMs: 1000 });
    expect(children[1]?.delivered()[0]?.job).toMatchObject({ buildId: "b1", attempts: 1 });
  });

  it("leaves a job alone while the child reports progress", async () => {
    const { children, receipt } = await deliverOne(50);
    for (let step = 0; step < 5; step += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential progress ticks
      await tick(20);
      children[0]?.say({ type: "progress", receipt });
    }
    expect(children[0]?.killed).toBe(false);
  });

  it("stops watching a job once it is acked", async () => {
    const { children, receipt } = await deliverOne(30);
    children[0]?.say({ type: "ack", receipt });
    await tick(80);
    expect(children[0]?.killed).toBe(false);
  });

  it("stops watching a nacked job", async () => {
    const { children, receipt } = await deliverOne(30);
    children[0]?.say({ type: "nack", receipt, requeue: false });
    await tick(80);
    expect(children[0]?.killed).toBe(false);
  });

  it("does nothing without a lease, however long a job runs", async () => {
    const { children } = await deliverOne(0);
    await tick(80);
    expect(children[0]?.killed).toBe(false);
  });

  it("fails a job that keeps hanging the child past maxCrashRetries", async () => {
    const { queue, children } = await deliverOne(25, { maxCrashRetries: 1, crashLimit: 10 });
    for (let round = 0; round < 2; round += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one hang per restarted child
      await tick(70);
      (children.at(-1) as FakeChild).exit(null, "SIGKILL");
      // oxlint-disable-next-line eslint/no-await-in-loop -- waits out the restart delay
      await tick(20);
      children.at(-1)?.say({ type: "poll", id: 1, waitMs: 1000 });
    }
    expect((await queue.status("b1"))?.status).toBe("failed");
  });

  it("ignores progress for a receipt it no longer knows", async () => {
    const { children } = await deliverOne(30);
    children[0]?.say({ type: "progress", receipt: "stale" });
    expect(children[0]?.killed).toBe(false);
  });
});

describe("ForkedCaptureQueue fallback", () => {
  it("hands unfinished jobs to the fallback after a crash loop", async () => {
    const { fallback, jobs } = fakeFallback();
    const { queue, children } = make({ fallback, crashLimit: 2, maxCrashRetries: 10 });
    await queue.enqueue({ buildId: "b1", reqId: "r1" });
    await queue.enqueue({ buildId: "b2" });
    children[0]?.say({ type: "poll", id: 1, waitMs: 1000 });
    children[0]?.exit(1);
    await tick(20);
    children[1]?.say({ type: "poll", id: 1, waitMs: 1000 });
    children[1]?.exit(1);
    await tick(5);

    expect(jobs.map((job) => job.buildId)).toEqual(expect.arrayContaining(["b1", "b2"]));
    expect(jobs).toHaveLength(2);
    expect(jobs.find((job) => job.buildId === "b1")).toMatchObject({ reqId: "r1" });
    expect(children).toHaveLength(2); // no third child after the trip
    expect((await queue.status("b1"))?.status).toBe("running"); // answered by the fallback
    expect((await queue.active()).map((entry) => entry.buildId)).toEqual(
      expect.arrayContaining(["b1", "b2"]),
    );
  });

  it("routes new work straight to the fallback once tripped", async () => {
    const { fallback, jobs } = fakeFallback();
    const { queue, children } = make({ fallback, crashLimit: 1 });
    await queue.enqueue({ buildId: "b1" });
    children[0]?.exit(1);
    await tick(5);
    await queue.enqueue({ buildId: "later" });
    expect(jobs.map((job) => job.buildId)).toContain("later");
    expect(children).toHaveLength(1);
    expect((await queue.recent(10)).map((entry) => entry.buildId)).toContain("later");
  });

  it("trips immediately when the child cannot be spawned", async () => {
    const { fallback, jobs } = fakeFallback();
    const queue = new ForkedCaptureQueue({
      fallback,
      spawn: () => {
        throw new Error("EAGAIN");
      },
    });
    await queue.enqueue({ buildId: "b1" });
    await tick(5);
    expect(jobs.map((job) => job.buildId)).toEqual(["b1"]);
  });

  it("fails jobs when forking is not viable and there is no fallback", async () => {
    const queue = new ForkedCaptureQueue({
      spawn: () => {
        throw new Error("EAGAIN");
      },
    });
    await queue.enqueue({ buildId: "b1" });
    await tick(5);
    expect((await queue.status("b1"))?.status).toBe("failed");
    await queue.enqueue({ buildId: "b2" });
    expect((await queue.status("b2"))?.error).toMatch(/no fallback/u);
  });

  it("does not trip on a single crash", async () => {
    const { fallback, jobs } = fakeFallback();
    const { queue, children } = make({ fallback, crashLimit: 3 });
    await queue.enqueue({ buildId: "b1" });
    children[0]?.exit(1);
    await tick(20);
    expect(jobs).toEqual([]);
    expect(children).toHaveLength(2);
  });
});

describe("ForkedCaptureQueue lifecycle", () => {
  it("kills the child on teardown, never restarts, and tolerates repeats", async () => {
    const { queue, children } = make();
    await queue.enqueue({ buildId: "b1" });
    await queue.lifecycle.teardown();
    await queue.lifecycle.teardown();
    expect(children[0]?.killed).toBe(true);
    children[0]?.exit(1);
    await tick(20);
    expect(children).toHaveLength(1);
    expect(await queue.lifecycle.health()).toEqual({ ok: true });
  });

  it("reports in-process fallback in its health detail", async () => {
    const { fallback } = fakeFallback();
    const { queue, children } = make({ fallback, crashLimit: 1 });
    await queue.enqueue({ buildId: "b1" });
    children[0]?.exit(1);
    await tick(5);
    expect((await queue.lifecycle.health()).detail).toMatch(/in-process/u);
  });

  it("lists recent entries newest first and respects the limit", async () => {
    const { queue } = make();
    await queue.enqueue({ buildId: "old" });
    await tick(3);
    await queue.enqueue({ buildId: "new" });
    expect((await queue.recent(1)).map((entry) => entry.buildId)).toEqual(["new"]);
    expect((await queue.active()).map((entry) => entry.buildId)).toEqual(["old", "new"]);
  });
});

queueContractSuite("forked", () => new ForkedCaptureQueue({ spawn: () => new FakeChild() }));
