import { describe, expect, it } from "vitest";
import { createLatch, deferred } from "../test-helpers/index.ts";
import { createPageLimiter } from "./page-limiter.ts";
import { createSessionGate } from "./session-gate.ts";

async function peakOf(
  limiter: ReturnType<typeof createPageLimiter>,
  count: number,
  limit: number,
): Promise<number> {
  let active = 0;
  let peak = 0;
  const latch = createLatch();
  const full = deferred();
  const work = limiter.each(
    Array.from({ length: count }, (_unused, index) => index),
    async () => {
      active += 1;
      peak = Math.max(peak, active);
      if (active === limit) full.resolve();
      await latch.wait();
      active -= 1;
      return false;
    },
  );
  await full.promise;
  latch.open();
  await work;
  limiter.dispose();
  return peak;
}

describe("createPageLimiter", () => {
  it("holds an explicit concurrency fixed", async () => {
    expect(await peakOf(createPageLimiter({ concurrency: 3 }), 30, 3)).toBe(3);
  });

  it("runs adaptively when no concurrency is given, within the host ceiling", async () => {
    const peak = await peakOf(createPageLimiter({ browser: "chromium" }), 60, 1);
    expect(peak).toBeGreaterThanOrEqual(1);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it("holds a remote target to its shared session gate, however many limiters run", async () => {
    const gate = createSessionGate(2);
    const peaks = await Promise.all([
      peakOf(createPageLimiter({ gate, concurrency: 50 }), 20, 2),
      peakOf(createPageLimiter({ gate }), 20, 2),
    ]);
    // Each limiter alone could reach 2; together they share the 2 sessions.
    let active = 0;
    let peak = 0;
    const latch = createLatch();
    const full = deferred();
    const limiters = [createPageLimiter({ gate }), createPageLimiter({ gate })];
    const work = Promise.all(
      limiters.map(
        async (limiter) =>
          await limiter.each(Array.from({ length: 10 }), async () => {
            active += 1;
            peak = Math.max(peak, active);
            if (active === 2) full.resolve();
            await latch.wait();
            active -= 1;
            return false;
          }),
      ),
    );
    await full.promise;
    latch.open();
    await work;
    for (const limiter of limiters) limiter.dispose();
    expect(Math.max(...peaks)).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
  });

  it("completes an empty run", async () => {
    await expect(createPageLimiter({}).each([], async () => false)).resolves.toBeUndefined();
  });
});
