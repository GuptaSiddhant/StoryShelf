import { describe, expect, it } from "vitest";
import { createSessionGate, sessionGateFor } from "./session-gate.ts";

async function peakOf(gate: { run<T>(fn: () => Promise<T>): Promise<T> }, runs: number) {
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: runs }, async () => {
      await gate.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
      });
    }),
  );
  return peak;
}

describe("session gates", () => {
  it("never runs more than its size at once, and hands slots on in order", async () => {
    expect(await peakOf(createSessionGate(3), 20)).toBe(3);
    const order: number[] = [];
    const gate = createSessionGate(1);
    await Promise.all(
      [1, 2, 3].map((n) =>
        gate.run(async () => {
          order.push(n);
          await Promise.resolve();
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it("releases the slot when the work throws", async () => {
    const gate = createSessionGate(1);
    await expect(gate.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(gate.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("counts a size below one as one", () => {
    expect(createSessionGate(0).size).toBe(1);
  });

  it("shares one gate per target across the process, keeping its first size", async () => {
    const first = sessionGateFor("chromium@gate-test", 2);
    expect(sessionGateFor("chromium@gate-test", 9)).toBe(first);
    expect(first.size).toBe(2);
    expect(sessionGateFor("firefox@gate-test", 4)).not.toBe(first);
    expect(await peakOf(sessionGateFor("chromium@gate-test", 2), 10)).toBe(2);
  });
});
