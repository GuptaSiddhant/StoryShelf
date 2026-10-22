import type { CaptureConsumer } from "@storyshelf/core/capture";
import { describe, expect, it, vi } from "vitest";
import { combineConsumers, jobMetrics, lazyConsumer } from "./consumer-setup.ts";

function fake(): CaptureConsumer & {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  let running = false;
  const stopped = Promise.withResolvers<null>();
  return {
    start: vi.fn(async () => {
      running = true;
      await stopped.promise;
      running = false;
    }),
    stop: vi.fn(async () => {
      stopped.resolve(null);
      await Promise.resolve();
    }),
    isRunning: () => running,
  };
}

describe("combineConsumers", () => {
  it("is nothing for no consumers, and the consumer itself for one", () => {
    const only = fake();
    expect(combineConsumers([])).toBeNull();
    expect(combineConsumers([only])).toBe(only);
  });

  it("starts and drains several as one", async () => {
    const [first, second] = [fake(), fake()];
    const both = combineConsumers([first, second]) as CaptureConsumer;
    const running = both.start();
    await Promise.resolve();
    expect(both.isRunning()).toBe(true);
    await both.stop();
    await running;
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
    expect(both.isRunning()).toBe(false);
  });
});

describe("lazyConsumer", () => {
  it("builds nothing until it is started, and stopping an unstarted one only runs the closers", async () => {
    const options = vi.fn();
    const closed = vi.fn(async () => {});
    const consumer = lazyConsumer(options as never, [closed]);
    expect(consumer.isRunning()).toBe(false);
    await consumer.stop();
    expect(options).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledOnce();
  });
});

describe("jobMetrics", () => {
  it("records finished jobs on the capture instruments without throwing", () => {
    const metrics = jobMetrics();
    for (const outcome of ["completed", "failed", "retried"] as const) {
      expect(() => {
        metrics.jobFinished?.({ kind: "publish", outcome, durationMs: 5, attempt: 1 });
      }).not.toThrow();
    }
  });
});
