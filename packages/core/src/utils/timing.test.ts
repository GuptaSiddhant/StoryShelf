import { describe, expect, it } from "vitest";
import { addTiming, runWithTimings, timed } from "./timing.ts";

async function failing(): Promise<never> {
  throw new Error("down");
}

describe("timing recorder", () => {
  it("is a no-op outside a scope", async () => {
    await expect(timed("db", async () => 42)).resolves.toBe(42);
    addTiming("db", 10);
  });

  it("aggregates sums per name within a scope", async () => {
    const { result, timings } = await runWithTimings(async () => {
      await timed("db", async () => {
        await Promise.resolve();
      });
      addTiming("db", 5);
      addTiming("storage", 7);
      return "done";
    });
    expect(result).toBe("done");
    expect(timings["storage"]).toBe(7);
    expect(timings["db"] ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("propagates errors and still records", async () => {
    const { timings } = await runWithTimings(async () => {
      await expect(timed("db", failing)).rejects.toThrow("down");
    });
    expect(typeof timings["db"]).toBe("number");
  });

  it("isolates nested scopes", async () => {
    const outer = await runWithTimings(async () => {
      addTiming("db", 1);
      const inner = await runWithTimings(async () => {
        addTiming("db", 2);
      });
      return inner.timings;
    });
    expect(outer.timings["db"]).toBe(1);
    expect(outer.result["db"]).toBe(2);
  });
});
