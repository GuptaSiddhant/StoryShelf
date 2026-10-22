import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  DEFAULT_BACKOFF_MS,
  DEFAULT_MAX_RETRIES,
  isFinalAttempt,
  MAX_BACKOFF_MS,
  retriesOf,
} from "./retry.ts";

describe("retry policy", () => {
  it("documents the defaults in one place", () => {
    expect(DEFAULT_MAX_RETRIES).toBe(2);
    expect(DEFAULT_BACKOFF_MS).toBe(1000);
  });

  it("doubles the delay per retry and caps it", () => {
    expect([0, 1, 2, 3].map((n) => backoffDelayMs(n))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelayMs(20)).toBe(MAX_BACKOFF_MS);
    expect(backoffDelayMs(1, 10)).toBe(20);
    expect(backoffDelayMs(20, 10_000, 300_000)).toBe(300_000);
  });

  it("counts deliveries for queues without a limit of their own", () => {
    expect(isFinalAttempt({ buildId: "b", attempts: 1 }, 2)).toBe(false);
    expect(isFinalAttempt({ buildId: "b", attempts: 2 }, 2)).toBe(true);
    expect(isFinalAttempt({ buildId: "b" }, 0)).toBe(true);
  });

  it("lets a queue that states maxAttempts decide", () => {
    expect(isFinalAttempt({ buildId: "b", attempt: 2, maxAttempts: 3 }, 0)).toBe(false);
    expect(isFinalAttempt({ buildId: "b", attempt: 3, maxAttempts: 3 }, 9)).toBe(true);
    expect(isFinalAttempt({ buildId: "b", attempts: 2, maxAttempts: 3 })).toBe(true);
  });

  it("derives retries from maxAttempts, else the fallback", () => {
    expect(retriesOf({ buildId: "b", maxAttempts: 4 })).toBe(3);
    expect(retriesOf({ buildId: "b", maxAttempts: 0 })).toBe(0);
    expect(retriesOf({ buildId: "b" }, 5)).toBe(5);
  });
});
