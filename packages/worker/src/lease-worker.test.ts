import type { PollableJob } from "@storyshelf/core/adapter/capture-queue";
import { describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@storyshelf/core/capture", () => ({
  createDispatchJob: () => run.fn,
}));

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const { createCaptureWorker } = await import("./index.ts");

function setup(extend: () => Promise<"ok" | "lost">, captureMs: number) {
  const job: PollableJob = { buildId: "b1", leaseMs: 30, attempts: 0 };
  let delivered = false;
  const queue = {
    metadata: { name: "m", version: "0", kind: "mock", category: "capture-queue" as const },
    enqueue: vi.fn(),
    status: vi.fn(),
    active: vi.fn(),
    recent: vi.fn(),
    poll: vi.fn(async () => {
      if (delivered) {
        return null;
      }
      delivered = true;
      return job;
    }),
    ack: vi.fn(async () => {}),
    nack: vi.fn(async () => {}),
    extend: vi.fn(extend),
  };
  run.fn.mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, captureMs)));
  const runner = { cancel: vi.fn(async () => {}), render: vi.fn() };
  const worker = createCaptureWorker({
    queue: queue as never,
    db: {} as never,
    storage: {} as never,
    runner: runner as never,
    scratchDir: ".tmp",
    logger: {
      info() {},
      warn() {},
      error() {},
      child() {
        return this;
      },
    } as never,
    config: { waitTimeSeconds: 0, concurrency: 1 },
  });
  return { queue, runner, worker };
}

describe("worker lease heartbeat", () => {
  it("renews through a capture 2x the lease, then acks and stops the timer", async () => {
    const { queue, worker } = setup(async () => "ok", 70);
    const started = worker.start();
    await sleep(150);
    expect(queue.extend.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(queue.ack).toHaveBeenCalledTimes(1);
    const calls = queue.extend.mock.calls.length;
    await sleep(60);
    expect(queue.extend.mock.calls.length).toBe(calls);
    await worker.stop();
    await started;
  });

  it("cancels the render and skips ack/nack when the lease is lost", async () => {
    const { queue, runner, worker } = setup(async () => "lost", 60_000);
    const started = worker.start();
    await sleep(80);
    expect(runner.cancel).toHaveBeenCalledWith("b1");
    expect(queue.ack).not.toHaveBeenCalled();
    expect(queue.nack).not.toHaveBeenCalled();
    await worker.stop();
    await started;
  });
});
