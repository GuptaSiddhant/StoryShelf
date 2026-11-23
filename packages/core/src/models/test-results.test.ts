import { describe, expect, it } from "vitest";
import { parseTestResults, summarizeTests, type TestResult } from "./test-results.ts";

describe("parseTestResults", () => {
  it("parses what a build holds and ignores anything else", () => {
    const good: TestResult = {
      id: "a:b",
      title: "T",
      name: "b",
      parentId: "a",
      status: "passed",
      durationMs: 1,
    };
    expect(parseTestResults(JSON.stringify([good, { nope: 1 }, "x"]))).toEqual([good]);
    expect(parseTestResults(null)).toEqual([]);
    expect(parseTestResults("not json")).toEqual([]);
    expect(parseTestResults('{"a":1}')).toEqual([]);
  });
});

const result = (status: TestResult["status"]): TestResult => ({
  id: status,
  title: "T",
  name: status,
  parentId: null,
  status,
  durationMs: 1,
});

describe("summarizeTests", () => {
  it("counts passed and failed results", () => {
    expect(summarizeTests([result("passed"), result("failed"), result("passed")])).toEqual({
      total: 3,
      passed: 2,
      failed: 1,
    });
  });
});
