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

    expect(runJob).toHaveBeenCalledWith({ buildId: "b1" });
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
});
