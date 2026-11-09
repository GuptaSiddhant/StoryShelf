import { metrics } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { captureMetrics, dbMetrics, storageMetrics } from "./metrics.ts";

describe("instruments", () => {
  it("memoizes capture instruments", () => {
    expect(captureMetrics()).toBe(captureMetrics());
    expect(captureMetrics().jobDuration).toBeDefined();
    expect(captureMetrics().jobsCompleted).toBeDefined();
    expect(captureMetrics().jobsFailed).toBeDefined();
    expect(captureMetrics().shardRepeatedSnapshots).toBeDefined();
  });

  it("memoizes db and storage instruments", () => {
    expect(dbMetrics()).toBe(dbMetrics());
    expect(storageMetrics()).toBe(storageMetrics());
    expect(dbMetrics().operationDuration).toBeDefined();
    expect(storageMetrics().operationDuration).toBeDefined();
  });

  it("names the repeated-snapshots counter exactly", async () => {
    vi.resetModules();
    const created: string[] = [];
    const meter = {
      createCounter: (name: string) => {
        created.push(name);
        return { add: () => {} };
      },
      createHistogram: () => ({ record: () => {} }),
    };
    vi.spyOn(metrics, "getMeter").mockReturnValue(meter as never);
    const fresh = await import("./metrics.ts");
    fresh.captureMetrics();
    vi.restoreAllMocks();
    expect(created).toContain("storyshelf.capture.shard.repeated_snapshots");
  });
});
