import { describe, expect, it, vi } from "vitest";
import { InMemoryCaptureQueue } from "./queue.ts";

interface Deferred {
  resolve: () => void;
  promise: Promise<void>;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}

async function flush(): Promise<void> {
  await new Promise((r) => {
    setTimeout(r, 0);
  });
}

describe("InMemoryCaptureQueue", () => {
  it("enqueues a job and runs it asynchronously to completion", async () => {
    const gate = deferred();
    const runJob = vi.fn(async () => {
      await gate.promise;
    });
    const queue = new InMemoryCaptureQueue({ concurrency: 2, runJob });

    const enqueued: boolean[] = [];
    await queue.enqueue({ buildId: "b1" });
    enqueued.push(true);
    await flush();

    expect(runJob).toHaveBeenCalledWith({ buildId: "b1" }, expect.anything());
    expect((await queue.status("b1"))?.status).toBe("running");

    gate.resolve();
    await gate.promise;
    await flush();

    const entry = await queue.status("b1");
    expect(enqueued).toEqual([true]);
    expect(entry?.status).toBe("completed");
    expect(entry?.startedAt).toBeTruthy();
    expect(entry?.finishedAt).toBeTruthy();
  });

  it("marks a job failed when the runner throws and still resolves enqueue", async () => {
    const runJob = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("boom");
    });
    const queue = new InMemoryCaptureQueue({ concurrency: 2, runJob });

    await expect(queue.enqueue({ buildId: "b1" })).resolves.toBeUndefined();

    await flush();
    const entry = await queue.status("b1");
    expect(entry?.status).toBe("failed");
    expect(entry?.error).toBe("boom");
    expect(entry?.finishedAt).toBeTruthy();
  });

  it("limits concurrency across enqueued jobs", async () => {
    const gates: Deferred[] = [];
    let activeCount = 0;
    let maxActive = 0;
    const runJob = vi.fn(async () => {
      const gate = deferred();
      gates.push(gate);
      activeCount += 1;
      maxActive = Math.max(maxActive, activeCount);
      await gate.promise;
      activeCount -= 1;
    });
    const queue = new InMemoryCaptureQueue({ concurrency: 1, runJob });

    await queue.enqueue({ buildId: "b1" });
    await queue.enqueue({ buildId: "b2" });

    await flush();
    expect(await queue.active()).toHaveLength(2);
    expect((await queue.status("b1"))?.status).toBe("running");
    expect((await queue.status("b2"))?.status).toBe("queued");

    gates[0]?.resolve();
    await gates[0]?.promise;
    await flush();
    expect((await queue.status("b2"))?.status).toBe("running");

    gates[1]?.resolve();
    await gates[1]?.promise;
    await flush();
    expect(maxActive).toBe(1);
    expect(await queue.active()).toHaveLength(0);
  });

  it("exposes active and recent views", async () => {
    const gate = deferred();
    const runJob = vi.fn(async () => {
      await gate.promise;
    });
    const queue = new InMemoryCaptureQueue({ concurrency: 2, runJob });

    await queue.enqueue({ buildId: "b1" });
    await queue.enqueue({ buildId: "b2" });
    await flush();

    const active = await queue.active();
    expect(active.map((e) => e.buildId)).toContain("b1");
    expect(active.map((e) => e.buildId)).toContain("b2");
    expect(await queue.recent(1)).toHaveLength(1);

    gate.resolve();
    await gate.promise;
    await flush();
    expect(await queue.active()).toHaveLength(0);
  });

  it("re-enqueuing an existing build resets its status to queued", async () => {
    const gate = deferred();
    const runJob = vi.fn(async () => {
      await gate.promise;
    });
    const queue = new InMemoryCaptureQueue({ concurrency: 1, runJob });

    await queue.enqueue({ buildId: "b1" });
    await queue.enqueue({ buildId: "b1" });
    await flush();

    const entries = [...new Set([...(await queue.recent(10))].map((e) => e.buildId))];
    expect(entries).toEqual(["b1"]);
    expect((await queue.status("b1"))?.status).toBe("queued");

    gate.resolve();
    await gate.promise;
    await flush();
    expect((await queue.status("b1"))?.status).toBe("completed");
  });

  describe("progress lease", () => {
    it("declares a silent job stalled, frees its slot, and calls onStalled once", async () => {
      const onStalled = vi.fn(async () => {});
      const runJob = vi.fn(async (job: { buildId: string }) => {
        if (job.buildId === "hung") {
          await new Promise<void>(() => {});
        }
      });
      const queue = new InMemoryCaptureQueue({ concurrency: 1, runJob, leaseMs: 30, onStalled });

      await queue.enqueue({ buildId: "hung" });
      await queue.enqueue({ buildId: "next" });
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(onStalled).toHaveBeenCalledTimes(1);
      expect(onStalled).toHaveBeenCalledWith({ buildId: "hung" }, expect.anything());
      const hung = await queue.status("hung");
      expect(hung?.status).toBe("failed");
      expect(hung?.error).toMatch(/stalled/u);
      expect((await queue.status("next"))?.status).toBe("completed");
    });

    it("keeps a job alive while it reports progress", async () => {
      const onStalled = vi.fn(async () => {});
      const runJob = vi.fn(async (_job: { buildId: string }, lease: { touch(): void }) => {
        for (let step = 0; step < 6; step += 1) {
          lease.touch();
          // oxlint-disable-next-line eslint/no-await-in-loop -- sequential progress ticks
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
      });
      const queue = new InMemoryCaptureQueue({ concurrency: 1, runJob, leaseMs: 40, onStalled });

      await queue.enqueue({ buildId: "slow" });
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(onStalled).not.toHaveBeenCalled();
      expect((await queue.status("slow"))?.status).toBe("completed");
    });

    it("does not stall jobs when no lease is configured", async () => {
      const onStalled = vi.fn(async () => {});
      const runJob = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      const queue = new InMemoryCaptureQueue({ concurrency: 1, runJob, onStalled });

      await queue.enqueue({ buildId: "b1" });
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(onStalled).not.toHaveBeenCalled();
      expect((await queue.status("b1"))?.status).toBe("completed");
    });

    it("leaves a requeued entry alone when recovery re-enqueues the stalled build", async () => {
      let calls = 0;
      const queue: InMemoryCaptureQueue = new InMemoryCaptureQueue({
        concurrency: 1,
        leaseMs: 30,
        runJob: async () => {
          calls += 1;
          if (calls === 1) {
            await new Promise<void>(() => {});
          }
        },
        onStalled: async (job) => {
          await queue.enqueue(job);
        },
      });

      await queue.enqueue({ buildId: "b1" });
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(calls).toBe(2);
      expect((await queue.status("b1"))?.status).toBe("completed");
    });

    it("survives a failing onStalled and still frees the slot", async () => {
      const queue = new InMemoryCaptureQueue({
        concurrency: 1,
        leaseMs: 30,
        runJob: async (job) => {
          if (job.buildId === "hung") {
            await new Promise<void>(() => {});
          }
        },
        onStalled: async () => {
          throw new Error("recovery blew up");
        },
      });

      await queue.enqueue({ buildId: "hung" });
      await queue.enqueue({ buildId: "next" });
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect((await queue.status("next"))?.status).toBe("completed");
    });
  });
});
