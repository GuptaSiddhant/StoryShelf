import { describe, expect, it, vi } from "vitest";
import type { CaptureRunner } from "../../adapters/capture-runner.ts";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { makeDatabase, makeStorage } from "../../test-helpers/fake-adapters.ts";
import { createCaptureHandler } from "./capture-handler.ts";
import { rig, stubLogger } from "./test-fixtures.ts";

function runner(): CaptureRunner {
  return {
    metadata: { name: "r", version: "0", kind: "mock", category: "capture-runner" },
    render: vi.fn(async () => ({ captures: [], failures: [] })),
    cancel: vi.fn(async () => {}),
  } as unknown as CaptureRunner;
}

function handlerOptions() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  return {
    db,
    storage,
    runner: runner(),
    scratchDir: ".tmp/handler-test",
    logger: stubLogger().logger,
    enqueue: async () => {},
  };
}

describe("createCaptureHandler", () => {
  it("accepts only jobs that name a build", () => {
    const handler = createCaptureHandler(handlerOptions());
    expect(handler.accepts?.({ buildId: "b1" })).toBe(true);
    expect(handler.accepts?.({ buildId: "" })).toBe(false);
  });

  it("cancels the render of the build, or of just the shard", async () => {
    const options = handlerOptions();
    const handler = createCaptureHandler(options);
    await handler.cancel?.({ buildId: "b1" });
    await handler.cancel?.({ buildId: "b1", shard: "s1" });
    expect(vi.mocked(options.runner.cancel).mock.calls[0]?.[0]).toBe("b1");
    expect(vi.mocked(options.runner.cancel).mock.calls[0]?.[1]).toBeUndefined();
    expect(options.runner.cancel).toHaveBeenNthCalledWith(2, "b1", "s1");
  });

  it("runs the core dispatch: a job for an unknown build fails with the dispatch's error", async () => {
    const options = handlerOptions();
    const handler = createCaptureHandler(options);
    await expect(
      handler.run({ buildId: "ghost", attempts: 0 }, { logger: options.logger, touch: () => {} }),
    ).rejects.toThrow("Build not found: ghost");
  });
});

describe("capture jobs through the consumer", () => {
  it("fails a job for an unknown build once its attempts are used, with the dispatch error", async () => {
    const options = handlerOptions();
    const r = rig({ db: options.db, retries: 1 });
    const consumer = r.consume({
      capture: { ...options },
      config: { concurrency: 1, maxRetries: 1, backoffMs: 1000 },
    });
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "ghost" });
    await r.clock.advance(10_000);
    expect(await new CaptureJobModel(r.db).get(id)).toMatchObject({
      status: "failed",
      error: "Build not found: ghost",
    });
    await consumer.stop();
    await started;
  });
});
