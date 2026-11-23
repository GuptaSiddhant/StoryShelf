/**
 * Readers of `builds.test_results`: the JSON list a build keeps of its Storybook `.test()` entries
 * (written once by `runProjectTests` in `capture/tests.ts`).
 */
/** What a build keeps of one `.test()` entry (JSON in `builds.test_results`). */
export interface TestResult {
  /** The test entry's id (`<story id>:<test name slug>`). */
  id: string;
  /** Story file title (the component path), as on its index entry. */
  title: string;
  /** The test's own name, as written in `story.test("...")`. */
  name: string;
  /** The story the test is written under. */
  parentId: string | null;
  status: "passed" | "failed";
  /** The failure message of a failed test. */
  error?: string;
  durationMs: number;
}

/** Pass and fail counts of a build's tests. */
export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
}

/** The results a build holds; empty for none or an unreadable value. */
export function parseTestResults(json: string | null | undefined): TestResult[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((item) => isTestResult(item)) : [];
  } catch {
    return [];
  }
}

/** Counts of a build's results. */
export function summarizeTests(results: readonly TestResult[]): TestSummary {
  const failed = results.filter((result) => result.status === "failed").length;
  return { total: results.length, passed: results.length - failed, failed };
}

function isTestResult(value: unknown): value is TestResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    typeof record["name"] === "string" &&
    (record["status"] === "passed" || record["status"] === "failed")
  );
}
