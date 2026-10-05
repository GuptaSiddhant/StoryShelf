import { describe, expect, it } from "vitest";
import { captureMetrics, dbMetrics, storageMetrics } from "./metrics.ts";

describe("instruments", () => {
  it("memoizes capture instruments", () => {
    expect(captureMetrics()).toBe(captureMetrics());
    expect(captureMetrics().jobDuration).toBeDefined();
    expect(captureMetrics().jobsCompleted).toBeDefined();
    expect(captureMetrics().jobsFailed).toBeDefined();
  });

  it("memoizes db and storage instruments", () => {
    expect(dbMetrics()).toBe(dbMetrics());
    expect(storageMetrics()).toBe(storageMetrics());
    expect(dbMetrics().operationDuration).toBeDefined();
    expect(storageMetrics().operationDuration).toBeDefined();
  });
});
