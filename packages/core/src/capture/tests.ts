/** Running a project's Storybook 10 `.test()` entries and keeping what they reported (ADR 0004, decision 10). */
import type { Logger } from "pino";
import type { CaptureRunner, CaptureTarget, TestOutcome } from "../adapters/capture-runner.ts";
import type { BuildModel } from "../models/build.ts";
import { emitAttemptLog, type AttemptLogRecorder } from "../models/capture-attempt.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import { redactSecrets } from "../utils/redact.ts";
import { isDisabledStory, type StoryEntry } from "./adapter.ts";
import { classifyFailures } from "./failure-sets.ts";
import { renderBudgetMs } from "./render.ts";
import type { StorybookUrlSource } from "./storybook-urls.ts";
import { StorybookAdapter } from "./storybook.ts";

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

/** Longest failure message kept (rows and logs stay bounded). */
const ERROR_MAX = 1000;

/** Test ids by how their failure counts, as {@link runProjectTests} classifies them. */
export interface TestRunSets {
  /** Fail the build, like a failing `play` function. */
  blocking: Set<string>;
  /** Tests of a story marked flaky: logged, never blocking. */
  flaky: Set<string>;
}

/** Inputs for {@link runProjectTests}. */
export interface RunTestsInput {
  runner: CaptureRunner;
  builds: BuildModel;
  build: Build;
  project: Project;
  storybookDir: string;
  /** Every discovered story, so the tests of a skipped story are skipped too. */
  stories: readonly StoryEntry[];
  target: CaptureTarget;
  storybookUrl?: StorybookUrlSource | undefined;
  logger: Logger | undefined;
  recordLog?: AttemptLogRecorder | undefined;
}

/**
 * Run the build's `.test()` entries when the project turned tests on, and store the results on the
 * build. A failing test is a blocking failure of its own id, exactly like a `play` that throws; it
 * takes no screenshot, writes no snapshot and sets no status of its own. Without the setting (or
 * without test entries) nothing runs and nothing is written, except that results left by an
 * earlier run of the same build are cleared.
 */
export async function runProjectTests(input: RunTestsInput): Promise<TestRunSets> {
  const tests = input.project.runTests ? await testsToRun(input) : [];
  const run = input.runner.runTests?.bind(input.runner);
  if (tests.length === 0 || !run) return await skipTests(input, tests.length);
  const results = resultsOf(tests, await execute(input, run, tests));
  await keepResults(input, results);
  return await reportFailures(input, results, tests);
}

/** Nothing to run: warn when tests were wanted but the runner cannot, and clear stale results. */
async function skipTests(input: RunTestsInput, wanted: number): Promise<TestRunSets> {
  if (wanted > 0) {
    input.logger?.warn(
      { tests: wanted },
      "project runs tests but the capture runner cannot run them; skipped",
    );
  }
  await keepResults(input, null);
  return { blocking: new Set(), flaky: new Set() };
}

/** The test entries to run: those of stories that are not skipped. */
async function testsToRun(input: RunTestsInput): Promise<StoryEntry[]> {
  const skipped = new Set(input.stories.filter((story) => isDisabledStory(story)).map((s) => s.id));
  const found = await new StorybookAdapter().discoverTests(input.storybookDir);
  return found.filter(
    (entry) =>
      !isDisabledStory(entry) && !(entry.parentId !== undefined && skipped.has(entry.parentId)),
  );
}

async function execute(
  input: RunTestsInput,
  run: NonNullable<CaptureRunner["runTests"]>,
  tests: StoryEntry[],
): Promise<TestOutcome[]> {
  const storybookUrl = await input.storybookUrl?.(input.target, {
    budgetMs: renderBudgetMs(tests.length),
  });
  await emitAttemptLog(input.recordLog, input.logger, "info", "running storybook tests", {
    tests: tests.length,
  });
  return await run({
    buildId: input.build.id,
    storybookDir: input.storybookDir,
    tests,
    playTimeoutMs: input.project.playTimeoutMs,
    target: input.target,
    ...(storybookUrl === undefined ? {} : { storybookUrl }),
    ...(input.logger ? { logger: input.logger } : {}),
  });
}

/** One result per test entry; a test the runner reported nothing for counts as failed. */
function resultsOf(tests: readonly StoryEntry[], outcomes: readonly TestOutcome[]): TestResult[] {
  const byId = new Map(outcomes.map((outcome) => [outcome.storyId, outcome]));
  return tests.map((test) => {
    const outcome = byId.get(test.id);
    const error =
      outcome === undefined ? "the runner reported no result for this test" : outcome.error;
    const failed = outcome === undefined || outcome.status === "failed";
    return {
      id: test.id,
      title: test.title,
      name: test.name,
      parentId: test.parentId ?? null,
      status: failed ? "failed" : "passed",
      ...(failed ? { error: redactSecrets(error ?? "test failed").slice(0, ERROR_MAX) } : {}),
      durationMs: outcome?.durationMs ?? 0,
    };
  });
}

/** Write the results; a build that has none and never had any is left untouched. */
async function keepResults(input: RunTestsInput, results: TestResult[] | null): Promise<void> {
  if (results === null && !input.build.testResults) return;
  await input.builds.setTestResults(input.build.id, results);
}

async function reportFailures(
  input: RunTestsInput,
  results: readonly TestResult[],
  tests: readonly StoryEntry[],
): Promise<TestRunSets> {
  const failed = results.filter((result) => result.status === "failed");
  const classified = classifyFailures(
    tests,
    failed.map((result) => ({
      storyId: result.id,
      viewportName: "test",
      error: result.error ?? "",
    })),
  );
  const sets = { blocking: classified.blocking, flaky: classified.flaky };
  const fields = { tests: results.length, failed: failed.length, flaky: sets.flaky.size };
  const level = sets.blocking.size > 0 ? "error" : "info";
  input.logger?.[level](fields, "storybook tests finished");
  await emitAttemptLog(input.recordLog, input.logger, level, "storybook tests finished", fields);
  return sets;
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
