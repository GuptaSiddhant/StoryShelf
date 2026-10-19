import { describe, expect, it } from "vitest";
import { createPageLimiter } from "./page-limiter.ts";

async function peakOf(
  limiter: ReturnType<typeof createPageLimiter>,
  count: number,
): Promise<number> {
  let active = 0;
  let peak = 0;
  await limiter.each(
    Array.from({ length: count }, (_unused, index) => index),
    async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return false;
    },
  );
  limiter.dispose();
  return peak;
}

describe("createPageLimiter", () => {
  it("holds an explicit concurrency fixed", async () => {
    expect(await peakOf(createPageLimiter({ concurrency: 3 }), 30)).toBe(3);
  });

  it("runs adaptively when no concurrency is given, within the host ceiling", async () => {
    const peak = await peakOf(createPageLimiter({ browser: "chromium" }), 60);
    expect(peak).toBeGreaterThanOrEqual(1);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it("completes an empty run", async () => {
    await expect(createPageLimiter({}).each([], async () => false)).resolves.toBeUndefined();
  });
});
