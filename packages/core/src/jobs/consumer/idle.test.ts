import { describe, expect, it } from "vitest";
import { idleDelayMs, isFastEmptyPoll, MIN_BLOCKING_POLL_MS } from "./idle.ts";

describe("idle backoff", () => {
  it("computes a doubling delay capped at 5s", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((streak) => idleDelayMs(streak))).toEqual([
      250, 500, 1000, 2000, 4000, 5000, 5000,
    ]);
    expect(idleDelayMs(0)).toBe(250);
  });

  it("treats only sub-minimum empty polls as non-blocking", () => {
    expect(isFastEmptyPoll(MIN_BLOCKING_POLL_MS - 1)).toBe(true);
    expect(isFastEmptyPoll(MIN_BLOCKING_POLL_MS)).toBe(false);
  });
});
