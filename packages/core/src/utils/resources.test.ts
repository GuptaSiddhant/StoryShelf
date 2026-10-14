import { describe, expect, it } from "vitest";
import {
  detectResources,
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
