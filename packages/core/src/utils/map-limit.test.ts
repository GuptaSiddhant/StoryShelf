import { describe, expect, it } from "vitest";
import { chunk, mapLimit } from "./map-limit.ts";

describe("mapLimit", () => {
  it("never exceeds the limit and preserves order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });

  it("handles empty input and non-positive limits", async () => {
    expect(await mapLimit([], 4, async (n: number) => n)).toEqual([]);
    expect(await mapLimit([1, 2], 0, async (n) => n)).toEqual([1, 2]);
  });
});

describe("chunk", () => {
  it("splits into batches and treats non-positive sizes as one batch", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 0.5)).toEqual([[1], [2]]);
  });
});
