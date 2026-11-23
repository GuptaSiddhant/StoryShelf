import { describe, expect, it } from "vitest";
import { createManualClock } from "../../test-helpers/manual-clock.ts";
import { createWakeSignal } from "./wake.ts";

describe("createWakeSignal", () => {
  it("wakes every waiter on notify", async () => {
    const clock = createManualClock();
    const wake = createWakeSignal(clock.timers);
    const waits = [wake.wait(1000), wake.wait(1000)];
    wake.notify();
    expect(await Promise.all(waits)).toEqual([true, true]);
    expect(clock.pending).toBe(0);
  });

  it("times out without a notify", async () => {
    const clock = createManualClock();
    const wake = createWakeSignal(clock.timers);
    const waiting = wake.wait(500);
    await clock.advance(500);
    expect(await waiting).toBe(false);
    wake.notify();
  });

  it("releases waiters on close and resolves later waits at once", async () => {
    const clock = createManualClock();
    const wake = createWakeSignal(clock.timers);
    const waiting = wake.wait(10_000);
    wake.close();
    wake.close();
    expect(await waiting).toBe(false);
    expect(await wake.wait(10_000)).toBe(false);
  });

  it("catches a notify that came before the wait began", async () => {
    const clock = createManualClock();
    const wake = createWakeSignal(clock.timers);
    const seen = wake.version();
    wake.notify();
    expect(await wake.wait(10_000, seen)).toBe(true);
    expect(clock.pending).toBe(0);
    const waiting = wake.wait(100, wake.version());
    await clock.advance(100);
    expect(await waiting).toBe(false);
  });

  it("works on the real timers too", async () => {
    const wake = createWakeSignal();
    expect(await wake.wait(1)).toBe(false);
  });
});
