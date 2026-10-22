import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "../../test-helpers/manual-clock.ts";
import { REAL_TIMERS, repeatEvery } from "./timers.ts";

describe("queue timers", () => {
  it("repeats until stopped", async () => {
    const clock = createManualClock();
    const tick = vi.fn();
    const stop = repeatEvery(clock.timers, 100, tick);
    await clock.advance(350);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
    await clock.advance(500);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(clock.pending).toBe(0);
  });

  it("schedules and cancels on the real timers", async () => {
    const fired = vi.fn();
    REAL_TIMERS.clearTimeout(REAL_TIMERS.setTimeout(fired, 1));
    await new Promise<void>((resolve) => {
      REAL_TIMERS.setTimeout(resolve, -5);
    });
    expect(fired).not.toHaveBeenCalled();
  });
});
