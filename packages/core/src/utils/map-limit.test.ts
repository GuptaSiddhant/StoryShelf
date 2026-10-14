import { describe, expect, it } from "vitest";
import { mapLimit } from "./map-limit.ts";

describe("mapLimit", () => {
  it("keeps result order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      inFlight -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });

  it("handles empty input and clamps a non-positive limit", async () => {
    expect(await mapLimit([], 3, async (n: number) => await Promise.resolve(n))).toEqual([]);
    expect(await mapLimit([1, 2], 0, async (n) => await Promise.resolve(n))).toEqual([1, 2]);
  });
});
