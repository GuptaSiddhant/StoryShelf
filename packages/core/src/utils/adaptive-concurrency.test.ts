import { describe, expect, it } from "vitest";
import { AdaptiveConcurrency, isTimeoutError } from "./adaptive-concurrency.ts";
import { mapAdaptive } from "./map-adaptive.ts";

function controller(
  overrides: Partial<ConstructorParameters<typeof AdaptiveConcurrency>[0]> = {},
  lag = 0,
) {
  return new AdaptiveConcurrency({ initial: 2, max: 6, readLagMs: () => lag, ...overrides });
}

/** Feed one whole window of identical captures. */
function feed(ctl: AdaptiveConcurrency, durationMs: number, timedOutEvery = 0): void {
  const size = Math.max(8, ctl.limit * 2);
  for (let index = 0; index < size; index += 1) {
    ctl.observe({ durationMs, timedOut: timedOutEvery > 0 && index % timedOutEvery === 0 });
  }
}

describe("AdaptiveConcurrency", () => {
  it("starts at the initial limit, clamped to its bounds", () => {
    expect(controller().limit).toBe(2);
    expect(controller({ initial: 99 }).limit).toBe(6);
    expect(controller({ initial: 0 }).limit).toBe(1);
  });

  it("only sets the latency baseline in the first window", () => {
    const ctl = controller();
    feed(ctl, 100);
    expect(ctl.limit).toBe(2);
  });

  it("raises one step per healthy window up to the max", () => {
    const ctl = controller();
    feed(ctl, 100);
    for (let index = 0; index < 10; index += 1) {
      feed(ctl, 100);
    }
    expect(ctl.limit).toBe(6);
  });

  it("backs off by half on timeouts and holds before raising again", () => {
    const ctl = controller({ initial: 4, holdWindows: 2 });
    feed(ctl, 100);
    feed(ctl, 100); // 5
    expect(ctl.limit).toBe(5);
    feed(ctl, 100, 5); // timeouts: 5 -> 2
    expect(ctl.limit).toBe(2);
    feed(ctl, 100);
    feed(ctl, 100);
    expect(ctl.limit).toBe(2); // two held windows
    feed(ctl, 100);
    expect(ctl.limit).toBe(3);
  });

  it("never takes the latency baseline from a window with a timeout", () => {
    const ctl = controller({ initial: 4, max: 8 });
    // First window: seven normal captures and one 30 s navigation timeout.
    for (let index = 0; index < 7; index += 1) {
      ctl.observe({ durationMs: 1000 });
    }
    ctl.observe({ durationMs: 30_000, timedOut: true });
    expect(ctl.limit).toBe(2);
    feed(ctl, 1000); // the baseline: 1 s, not 30 s
    for (let window = 0; window < 4; window += 1) {
      feed(ctl, 10_000); // saturated: ten times slower, no timeouts
    }
    expect(ctl.limit).toBe(1);
  });

  it("steps down when p95 latency grows past the tolerance", () => {
    const ctl = controller({ initial: 4 });
    feed(ctl, 100);
    feed(ctl, 100); // 5
    feed(ctl, 200); // twice the baseline
    expect(ctl.limit).toBe(4);
  });

  it("steps down on event-loop lag and never goes below the min", () => {
    const ctl = controller({ initial: 2, min: 2 }, 500);
    feed(ctl, 100);
    feed(ctl, 100);
    expect(ctl.limit).toBe(2);
  });

  it("logs every change with its reason", () => {
    const entries: unknown[] = [];
    const logger = { info: (fields: unknown) => entries.push(fields) } as never;
    const ctl = controller({ logger });
    feed(ctl, 100);
    feed(ctl, 100);
    expect(entries).toEqual([expect.objectContaining({ from: 2, to: 3, reason: "healthy" })]);
  });
});

describe("mapAdaptive", () => {
  it("never exceeds the live limit and keeps result order", async () => {
    const ctl = controller({ initial: 3, max: 3 });
    let active = 0;
    let peak = 0;
    const out = await mapAdaptive(
      Array.from({ length: 20 }, (_unused, index) => index),
      ctl,
      async (item) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return { value: item * 2 };
      },
    );
    expect(out).toEqual(Array.from({ length: 20 }, (_unused, index) => index * 2));
    expect(peak).toBe(3);
  });

  it("follows the limit as it rises", async () => {
    const ctl = controller({ initial: 1, max: 4 });
    let active = 0;
    let peak = 0;
    await mapAdaptive(
      Array.from({ length: 80 }, (_unused, index) => index),
      ctl,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return { value: 0 };
      },
    );
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("rejects with the first failure after in-flight work drains", async () => {
    const ctl = controller({ initial: 2 });
    await expect(
      mapAdaptive([1, 2, 3, 4], ctl, async (item) => {
        await Promise.resolve();
        if (item === 2) {
          throw new Error("boom");
        }
        return { value: item };
      }),
    ).rejects.toThrow("boom");
  });

  it("resolves an empty list", async () => {
    expect(await mapAdaptive([], controller(), async () => ({ value: 1 }))).toEqual([]);
  });
});

describe("isTimeoutError", () => {
  it("recognises named and worded timeouts", () => {
    const named = new Error("x");
    named.name = "TimeoutError";
    expect(isTimeoutError(named)).toBe(true);
    expect(isTimeoutError(new Error("page.goto: Timeout 30000ms exceeded"))).toBe(true);
    expect(isTimeoutError(new Error("navigation timed out"))).toBe(true);
    expect(isTimeoutError(new Error("boom"))).toBe(false);
    expect(isTimeoutError("timeout")).toBe(false);
  });
});
