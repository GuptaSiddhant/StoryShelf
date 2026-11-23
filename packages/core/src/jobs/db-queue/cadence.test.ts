import { describe, expect, it } from "vitest";
import {
  ACTIVE_POLL_MS,
  ACTIVE_WINDOW_MS,
  CANCEL_CHECK_MS,
  DEFAULT_CADENCE,
  IDLE_POLL_MS,
  nextPollDelay,
} from "./cadence.ts";

describe("nextPollDelay", () => {
  it("polls every 15 s when idle and every 2 s after recent work", () => {
    expect(IDLE_POLL_MS).toBe(15_000);
    expect(ACTIVE_POLL_MS).toBe(2000);
    expect(CANCEL_CHECK_MS).toBe(5000);
    expect(nextPollDelay(null, 0, DEFAULT_CADENCE, () => 0)).toBe(IDLE_POLL_MS);
    expect(nextPollDelay(1000, 2000, DEFAULT_CADENCE, () => 0)).toBe(ACTIVE_POLL_MS);
    expect(nextPollDelay(0, ACTIVE_WINDOW_MS, DEFAULT_CADENCE, () => 0)).toBe(IDLE_POLL_MS);
  });

  it("adds jitter but never shortens the interval", () => {
    const delays = [0, 0.5, 0.99, 1, 7, -3].map((r) =>
      nextPollDelay(null, 0, DEFAULT_CADENCE, () => r),
    );
    expect(Math.min(...delays)).toBe(IDLE_POLL_MS);
    expect(Math.max(...delays)).toBeLessThanOrEqual(IDLE_POLL_MS * 1.2);
    expect(nextPollDelay(null, 0)).toBeGreaterThanOrEqual(IDLE_POLL_MS);
  });

  it("follows a custom cadence", () => {
    const cadence = { idleMs: 100, activeMs: 10, activeWindowMs: 50, jitter: 0 };
    expect(nextPollDelay(null, 0, cadence)).toBe(100);
    expect(nextPollDelay(0, 49, cadence)).toBe(10);
  });
});
