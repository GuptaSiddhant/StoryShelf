import { describe, expect, it } from "vitest";
import {
  describeSizing,
  detectResources,
  engineWeight,
  maxPageConcurrency,
  recommendedBuildConcurrency,
  recommendedNavigationTimeoutMs,
  recommendedPageConcurrency,
} from "./resources.ts";

const GB = 1024 ** 3;

describe("recommendedPageConcurrency", () => {
  it("uses one page on 0.5 vCPU / 1 GB and on 1 vCPU / 2 GB", () => {
    expect(recommendedPageConcurrency({ cpus: 0.5, memoryBytes: 1 * GB })).toBe(1);
    expect(recommendedPageConcurrency({ cpus: 1, memoryBytes: 2 * GB })).toBe(1);
  });

  it("scales with CPUs and memory, capped at 4", () => {
    expect(recommendedPageConcurrency({ cpus: 2, memoryBytes: 4 * GB })).toBe(2);
    expect(recommendedPageConcurrency({ cpus: 16, memoryBytes: 64 * GB })).toBe(4);
    expect(recommendedPageConcurrency({ cpus: 8, memoryBytes: 1 * GB })).toBe(1);
  });
});

describe("engine weights", () => {
  it("counts Firefox and WebKit as two Chromium slots", () => {
    expect(engineWeight("chromium")).toBe(1);
    expect(engineWeight("chrome")).toBe(1);
    expect(engineWeight("firefox")).toBe(2);
    expect(engineWeight("webkit")).toBe(2);
    expect(engineWeight()).toBe(1);
  });

  it("halves the page budget for heavier engines, never below one", () => {
    const roomy = { cpus: 16, memoryBytes: 64 * GB };
    expect(recommendedPageConcurrency(roomy, "chromium")).toBe(4);
    expect(recommendedPageConcurrency(roomy, "firefox")).toBe(2);
    expect(recommendedPageConcurrency({ cpus: 1, memoryBytes: 2 * GB }, "webkit")).toBe(1);
  });

  it("lets the adaptive ceiling exceed the CPU-sized start, bounded by memory", () => {
    const host = { cpus: 2, memoryBytes: 8 * GB };
    expect(recommendedPageConcurrency(host)).toBe(2);
    expect(maxPageConcurrency(host)).toBe(4);
    expect(maxPageConcurrency(host, "firefox")).toBe(2);
    expect(maxPageConcurrency({ cpus: 8, memoryBytes: 1 * GB })).toBe(1);
    expect(maxPageConcurrency({ cpus: 64, memoryBytes: 256 * GB })).toBe(8);
  });
});

describe("recommendedBuildConcurrency", () => {
  it("runs one build at a time unless there is room for two browsers", () => {
    expect(recommendedBuildConcurrency({ cpus: 1, memoryBytes: 8 * GB })).toBe(1);
    expect(recommendedBuildConcurrency({ cpus: 4, memoryBytes: 2 * GB })).toBe(1);
    expect(recommendedBuildConcurrency({ cpus: 4, memoryBytes: 8 * GB })).toBe(2);
  });
});

describe("recommendedNavigationTimeoutMs", () => {
  it("extends the timeout when CPU starved", () => {
    expect(recommendedNavigationTimeoutMs({ cpus: 0.5, memoryBytes: GB })).toBe(90_000);
    expect(recommendedNavigationTimeoutMs({ cpus: 1, memoryBytes: GB })).toBe(60_000);
    expect(recommendedNavigationTimeoutMs({ cpus: 4, memoryBytes: GB })).toBe(30_000);
  });
});

describe("detectResources", () => {
  it("reports positive CPU and memory", () => {
    const resources = detectResources();
    expect(resources.cpus).toBeGreaterThan(0);
    expect(resources.memoryBytes).toBeGreaterThan(0);
  });
});

describe("describeSizing", () => {
  it("reports explicit settings and fills the rest from the host", () => {
    const sizing = describeSizing({ concurrency: 3, recycleBrowserEvery: 0 });
    expect(sizing["pages"]).toBe(3);
    expect(sizing["recycleBrowserEvery"]).toBe(0);
    expect(sizing["cpus"]).toBeGreaterThan(0);
    expect(sizing["navigationTimeoutMs"]).toBeGreaterThanOrEqual(30_000);
  });
});
