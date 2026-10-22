import type { PollableCaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import type { ShelfOptions } from "@storyshelf/core/config";
import { createShelfLogger } from "@storyshelf/core/logger";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { setupJobs } from "./jobs-setup.ts";
import { resolveRuntime } from "./runtime.ts";
import { stubRunner } from "./test-runner.ts";

const logger = createShelfLogger({ level: "silent" });

function wire(testing?: ShelfOptions["testing"], env: NodeJS.ProcessEnv = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const options = { database: db, storage, logger, testing } as unknown as ShelfOptions;
  return { db, wiring: setupJobs(options, resolveRuntime(options), env) };
}

function suppliedQueue(poll = vi.fn(async () => null)): PollableCaptureQueue {
  return {
    metadata: { name: "q", version: "0", kind: "sqs", category: "capture-queue" },
    enqueue: vi.fn(async () => {}),
    status: vi.fn(async () => null),
    active: vi.fn(async () => []),
    recent: vi.fn(async () => []),
    poll,
    ack: vi.fn(async () => {}),
    nack: vi.fn(async () => {}),
  } as unknown as PollableCaptureQueue;
}

describe("setupJobs", () => {
  it("hosting only on a long-running host: publishes through one consumer, captures nothing", () => {
    const { wiring } = wire();
    expect(wiring.captureQueue).toBeNull();
    expect(wiring.enqueueCapture).toBeUndefined();
    expect(wiring.capturesHere).toBe(false);
    expect(wiring.publish.enqueuePublish).toBeTypeOf("function");
    expect(wiring.consumer?.isRunning()).toBe(false);
  });

  it("hosting only on a serverless host: no queue, no consumer", () => {
    const { wiring } = wire(undefined, { VERCEL: "1" });
    expect(wiring.consumer).toBeNull();
    expect(wiring.publish.enqueuePublish).toBeUndefined();
  });

  it("testing with a runner: captures and publishes on the database queue, consumed here", async () => {
    const { wiring } = wire({ runner: stubRunner() });
    expect(wiring.captureQueue?.metadata.kind).toBe("database");
    expect(wiring.capturesHere).toBe(true);
    expect(wiring.enqueueCapture).toBeTypeOf("function");
    await wiring.enqueueCapture?.("build-1", "req-1");
    expect(await wiring.captureQueue?.active()).toEqual([
      expect.objectContaining({ buildId: "build-1", status: "queued" }),
    ]);
    expect(wiring.consumer).not.toBeNull();
  });

  it("testing with a runner on a serverless host still consumes captures (it was warned about)", () => {
    const { wiring } = wire({ runner: stubRunner() }, { VERCEL: "1" });
    expect(wiring.capturesHere).toBe(true);
    expect(wiring.publish.enqueuePublish).toBeUndefined();
    expect(wiring.consumer).not.toBeNull();
  });

  it("a supplied queue without a runner is enqueue-only; publishing still has its consumer", async () => {
    const queue = suppliedQueue();
    const { wiring } = wire({ queue });
    expect(wiring.captureQueue).toBe(queue);
    expect(wiring.capturesHere).toBe(false);
    await wiring.enqueueCapture?.("build-1");
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(wiring.consumer).not.toBeNull();
    await wiring.consumer?.stop();
  });

  it("a supplied queue with a runner is consumed here too, next to the database queue", async () => {
    const polled = Promise.withResolvers<null>();
    const queue = suppliedQueue(
      vi.fn(async () => {
        polled.resolve(null);
        await Promise.resolve();
        return null;
      }),
    );
    const { wiring } = wire({ queue, runner: stubRunner() });
    expect(wiring.capturesHere).toBe(true);
    const running = wiring.consumer?.start();
    await polled.promise;
    expect(wiring.consumer?.isRunning()).toBe(true);
    await wiring.consumer?.stop();
    await running;
    expect(wiring.consumer?.isRunning()).toBe(false);
  });

  it("starts, serves a database job and drains", async () => {
    const { wiring } = wire({ runner: stubRunner() });
    const running = wiring.consumer?.start();
    await wiring.enqueueCapture?.("missing-build");
    // The build does not exist: the handler fails the attempt (it is retried later), and the
    // consumer carries on. What matters is that the job was claimed.
    await vi.waitFor(async () => {
      expect((await wiring.captureQueue?.status("missing-build"))?.startedAt).toBeDefined();
    });
    await wiring.consumer?.stop();
    await running;
  });
});
