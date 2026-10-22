import type { TestResult } from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";
import { testsSummaryNote } from "./build-tests.tsx";

const PASSED: TestResult = {
  id: "b--a:works",
  title: "Components/Button",
  name: "works",
  parentId: "b--a",
  status: "passed",
  durationMs: 4,
};
const FAILED: TestResult = {
  id: "b--a:breaks",
  title: "Components/Button",
  name: "breaks",
  parentId: "b--a",
  status: "failed",
  error: "expect(element).toHaveTextContent()\n\nExpected: Not the label",
  durationMs: 9,
};

async function buildPage(results: TestResult[] | null): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db).create({ name: "Docs" });
  const builds = new BuildModel(db);
  const build = await builds.create(project.id, { gitSha: "abc1234def", gitBranch: "feature/x" });
  if (results) await builds.setTestResults(build.id, results);
  const app = createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  return await (await app.request(`/projects/${project.slug}/builds/${build.id}`)).text();
}

describe("build page: Storybook tests", () => {
  it("lists failures with their message first and the passes behind a disclosure", async () => {
    const html = await buildPage([PASSED, FAILED]);
    expect(html).toContain("Storybook tests");
    expect(html).toContain("1 failed");
    expect(html).toContain(
      "1 of 2 failed. A failing test fails the build, like a failing play function.",
    );
    expect(html).toContain("Not the label");
    expect(html).toContain("Passed tests (1)");
    expect(html.indexOf("breaks")).toBeLessThan(html.indexOf("works"));
  });

  it("says all passed when none failed", async () => {
    const html = await buildPage([PASSED]);
    expect(html).toContain("all passed");
    expect(html).toContain("All 1 passed.");
    expect(html).not.toContain("1 failed");
  });

  it("shows nothing for a build that ran no tests", async () => {
    expect(await buildPage(null)).not.toContain("Storybook tests");
    expect(await buildPage([])).not.toContain("Storybook tests");
  });
});

describe("testsSummaryNote", () => {
  it("covers every count", () => {
    expect(testsSummaryNote([])).toBe("No Storybook tests ran.");
    expect(testsSummaryNote([PASSED, PASSED])).toBe("All 2 passed.");
    expect(testsSummaryNote([FAILED])).toContain("1 of 1 failed");
  });
});
