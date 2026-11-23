import { afterEach, describe, expect, it, vi } from "vitest";
import { remainingUntil, within } from "./deadline.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("within", () => {
  it("settles with the work when it finishes first, and clears its timer", async () => {
    vi.useFakeTimers();
    await expect(within(Promise.resolve("done"), 1000, "late")).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles with the fallback once the time is up", async () => {
    vi.useFakeTimers();
    const racing = within(new Promise<string>(() => {}), 50, "late");
    await vi.advanceTimersByTimeAsync(50);
    await expect(racing).resolves.toBe("late");
  });

  it("treats a negative budget as none", async () => {
    await expect(within(new Promise<string>(() => {}), -5, "late")).resolves.toBe("late");
  });
});

describe("remainingUntil", () => {
  it("counts down to the deadline and never goes below zero", () => {
    vi.useFakeTimers({ now: 1000 });
    expect(remainingUntil(1500)).toBe(500);
    expect(remainingUntil(900)).toBe(0);
  });
});
