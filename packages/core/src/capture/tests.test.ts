import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRunner, TestOutcome } from "../adapters/capture-runner.ts";
import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import type { StoryEntry } from "./adapter.ts";
import {
  parseTestResults,
  runProjectTests,
  summarizeTests,
  type RunTestsInput,
  type TestResult,
} from "./tests.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "storyshelf-tests-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function entry(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: id,
    title: "Components/Button",
    importPath: "./b.stories.tsx",
    type: "story",
    ...extra,
  };
}

async function writeIndex(entries: Record<string, unknown>[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "index.json"),
    JSON.stringify({ v: 5, entries: Object.fromEntries(entries.map((e) => [e["id"], e])) }),
  );
}

function testEntry(parent: string, slug: string, tags: string[] = []): Record<string, unknown> {
  return entry(`${parent}:${slug}`, { subtype: "test", parent, name: slug, tags });
}

const STORIES: StoryEntry[] = [
  { id: "b--primary", title: "Components/Button", name: "Primary", type: "story" },
  { id: "b--skipped", title: "Components/Button", name: "Skipped", type: "story", tags: ["skip"] },
];

async function setup(
  projectPatch: Record<string, unknown>,
  runTests: CaptureRunner["runTests"] | undefined,
  stories: StoryEntry[] = STORIES,
) {
  const { db } = makeDatabase();
  const tables = {
    builds: db.tables.builds,
    buildLabels: db.tables.buildLabels,
    snapshots: db.tables.snapshots,
    projects: db.tables.projects,
  };
  const projects = new ProjectModel(db, tables);
  const created = await projects.create({ name: "Tests" });
  await db.update(db.tables.projects, created.id, projectPatch);
  const builds = new BuildModel(db, tables);
  const build = await builds.create(created.id, {
    gitSha: "sha",
    gitBranch: "main",
    isDefault: false,
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const recordLog = vi.fn(async () => {});
  const runner = {
    metadata: { name: "fake", version: "0", kind: "fake", category: "capture-runner" },
    render: vi.fn(),
    cancel: vi.fn(),
    ...(runTests ? { runTests } : {}),
  } as unknown as CaptureRunner;
  const input = async (): Promise<RunTestsInput> => ({
    runner,
    builds,
    build: (await builds.get(build.id)) ?? build,
    project: (await projects.get(created.id)) ?? created,
    storybookDir: dir,
    stories,
    target: "chromium",
    logger: logger as never,
    recordLog,
  });
  return { input, builds, buildId: build.id, logger, recordLog };
}

const outcome = (storyId: string, status: "passed" | "failed", error?: string): TestOutcome => ({
  storyId,
  status,
  durationMs: 12,
  ...(error === undefined ? {} : { error }),
});

describe("runProjectTests", () => {
  it("does nothing, and writes nothing, when the project does not run tests", async () => {
    await writeIndex([entry("b--primary"), testEntry("b--primary", "works")]);
    const runTests = vi.fn(async () => []);
    const { input, builds, buildId } = await setup({}, runTests);
    const sets = await runProjectTests(await input());
    expect(runTests).not.toHaveBeenCalled();
    expect(sets.blocking.size).toBe(0);
    expect((await builds.get(buildId))?.testResults).toBeFalsy();
  });

  it("runs the test entries, keeps the results and fails the build's story set on a failure", async () => {
    await writeIndex([
      entry("b--primary"),
      testEntry("b--primary", "works"),
      testEntry("b--primary", "breaks"),
    ]);
    const runTests = vi.fn(async () => [
      outcome("b--primary:works", "passed"),
      outcome("b--primary:breaks", "failed", "expected 1 to be 2"),
    ]);
    const { input, builds, buildId, recordLog } = await setup(
      { runTests: true, playTimeoutMs: 4321 },
      runTests,
    );

    const sets = await runProjectTests(await input());

    expect([...sets.blocking]).toEqual(["b--primary:breaks"]);
    const call = (
      runTests.mock.calls[0] as unknown as [
        { tests: StoryEntry[]; playTimeoutMs: number; target: string },
      ]
    )[0];
    expect(call.tests.map((t) => [t.id, t.parentId])).toEqual([
      ["b--primary:works", "b--primary"],
      ["b--primary:breaks", "b--primary"],
    ]);
    expect(call.playTimeoutMs).toBe(4321);
    expect(call.target).toBe("chromium");
    const stored = parseTestResults((await builds.get(buildId))?.testResults);
    expect(stored.map((r) => [r.id, r.status, r.error])).toEqual([
      ["b--primary:works", "passed", undefined],
      ["b--primary:breaks", "failed", "expected 1 to be 2"],
    ]);
    expect(summarizeTests(stored)).toEqual({ total: 2, passed: 1, failed: 1 });
    expect(recordLog).toHaveBeenCalledWith("error", "storybook tests finished", expect.anything());
  });

  it("does not fail the build for a failing test of a flaky story", async () => {
    await writeIndex([entry("b--primary"), testEntry("b--primary", "flaky", ["flaky-test"])]);
    const runTests = vi.fn(async () => [outcome("b--primary:flaky", "failed", "nope")]);
    const { input, builds, buildId } = await setup({ runTests: true }, runTests);
    const sets = await runProjectTests(await input());
    expect(sets.blocking.size).toBe(0);
    expect([...sets.flaky]).toEqual(["b--primary:flaky"]);
    expect(parseTestResults((await builds.get(buildId))?.testResults)[0]?.status).toBe("failed");
  });

  it("skips the tests of a skipped story", async () => {
    await writeIndex([
      entry("b--primary"),
      entry("b--skipped", { tags: ["skip"] }),
      testEntry("b--skipped", "inherits-skip"),
      testEntry("b--primary", "works"),
    ]);
    const runTests = vi.fn(async () => [outcome("b--primary:works", "passed")]);
    const { input } = await setup({ runTests: true }, runTests);
    await runProjectTests(await input());
    const call = (runTests.mock.calls[0] as unknown as [{ tests: StoryEntry[] }])[0];
    expect(call.tests.map((t) => t.id)).toEqual(["b--primary:works"]);
  });

  it("counts a test the runner reported nothing for as failed, and caps and scrubs messages", async () => {
    await writeIndex([
      entry("b--primary"),
      testEntry("b--primary", "silent"),
      testEntry("b--primary", "long"),
    ]);
    const runTests = vi.fn(async () => [
      outcome(
        "b--primary:long",
        "failed",
        `see http://x/?token=abcDEF123456789 ${"x".repeat(5000)}`,
      ),
    ]);
    const { input, builds, buildId } = await setup({ runTests: true }, runTests);
    const sets = await runProjectTests(await input());
    expect(sets.blocking.size).toBe(2);
    const stored = parseTestResults((await builds.get(buildId))?.testResults);
    expect(stored[0]?.error).toMatch(/no result/u);
    expect(stored[1]?.error?.length).toBeLessThanOrEqual(1000);
    expect(stored[1]?.error).not.toContain("abcDEF123456789");
  });

  it("warns and skips when the runner cannot run tests", async () => {
    await writeIndex([entry("b--primary"), testEntry("b--primary", "works")]);
    const { input, builds, buildId, logger } = await setup({ runTests: true }, undefined);
    const sets = await runProjectTests(await input());
    expect(sets.blocking.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith({ tests: 1 }, expect.stringContaining("cannot run"));
    expect((await builds.get(buildId))?.testResults).toBeFalsy();
  });

  it("clears results an earlier run of the build left when there is nothing to run now", async () => {
    await writeIndex([entry("b--primary")]);
    const runTests = vi.fn(async () => []);
    const { input, builds, buildId } = await setup({ runTests: true }, runTests);
    await builds.setTestResults(buildId, [{ id: "old", name: "old", status: "passed" }]);
    await runProjectTests(await input());
    expect(runTests).not.toHaveBeenCalled();
    expect((await builds.get(buildId))?.testResults).toBeNull();
  });

  it("passes the signed URL a reach-url target needs", async () => {
    await writeIndex([entry("b--primary"), testEntry("b--primary", "works")]);
    const runTests = vi.fn(async () => [outcome("b--primary:works", "passed")]);
    const { input } = await setup({ runTests: true }, runTests);
    const urls = vi.fn(async () => "https://shelf.example.com/_s/t/");
    await runProjectTests({ ...(await input()), storybookUrl: urls });
    expect(urls).toHaveBeenCalledWith(
      "chromium",
      expect.objectContaining({ budgetMs: expect.any(Number) }),
    );
    const call = (runTests.mock.calls[0] as unknown as [{ storybookUrl?: string }])[0];
    expect(call.storybookUrl).toBe("https://shelf.example.com/_s/t/");
  });
});

describe("test result helpers", () => {
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
