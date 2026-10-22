import { createShelfApp } from "@storyshelf/app";
import type { StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { StorybookAdapter } from "@storyshelf/core/capture";
import { parseTestResults } from "@storyshelf/core/capture";
import type { Build, Snapshot } from "@storyshelf/core/schema";
import { createSqliteDatabase } from "@storyshelf/db-sqlite";
import { createLocalStorage } from "@storyshelf/storage-local";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPlaywrightCaptureRunner } from "./capture-runner.ts";
import { ensureFixtureBuilt, readJson, uploadBuild, waitForBuild } from "./integration-harness.ts";

/**
 * Real-browser checks of render-settled signalling (ADR 0004, decision 9) and of the Storybook 10
 * `.test()` runs (decision 10), on whichever fixture `FIXTURE_DIR` names. Storybook 8 and 9 have no
 * test entries, so those checks assert the no-op there.
 */
const viewports = [{ name: "desktop", width: 800, height: 600 }];
const storyOf = (id: string): StoryEntry => ({
  id,
  title: "Components/Button",
  name: id,
  type: "story",
});

const logger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child() {
    return this;
  },
});

let staticDir = "";
let tmp = "";
let testEntries: StoryEntry[] = [];

beforeAll(async () => {
  staticDir = await ensureFixtureBuilt();
  tmp = await mkdtemp(join(tmpdir(), "storyshelf-settle-"));
  testEntries = await new StorybookAdapter().discoverTests(staticDir);
}, 300_000);

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** A one-page "Storybook" that exposes a channel which never announces anything. */
async function silentStorybook(channel: boolean): Promise<string> {
  const dir = join(tmp, channel ? "silent-channel" : "no-channel");
  await mkdir(dir, { recursive: true });
  const script = channel
    ? "<script>window.__STORYBOOK_ADDONS_CHANNEL__ = { on() {} };</script>"
    : "";
  await writeFile(
    join(dir, "iframe.html"),
    `<!doctype html><html><body>${script}<div id="storybook-root">hello</div></body></html>`,
  );
  return dir;
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("render-settled signalling", () => {
  it("waits for Storybook's own event: no fixed-wait fallback, and a stable screenshot", async () => {
    const runner = createPlaywrightCaptureRunner();
    const log = logger();
    const input = {
      buildId: "settle-1",
      storybookDir: staticDir,
      stories: [storyOf("components-button--primary"), storyOf("components-button--secondary")],
      viewports,
      logger: log as never,
    };
    const first = await runner.render(input);
    const again = await runner.render(input);
    expect(first.failures).toEqual([]);
    expect(first.captures).toHaveLength(2);
    expect(log.warn).not.toHaveBeenCalled();
    // The same story, photographed twice from a settled page, is the same picture.
    const pictures = (result: typeof first): Record<string, string> =>
      Object.fromEntries(result.captures.map((c) => [c.story.id, c.screenshot.toString("base64")]));
    expect(pictures(again)).toEqual(pictures(first));
  }, 120_000);

  it("settles on a story whose play function throws, and says what Storybook reported", async () => {
    const runner = createPlaywrightCaptureRunner();
    const log = logger();
    const id = "components-button--flaky-tag";
    const result = await runner.render({
      buildId: "settle-2",
      storybookDir: staticDir,
      stories: [storyOf(id)],
      viewports,
      logger: log as never,
    });
    expect(result.captures).toHaveLength(1);
    // SB 8 reports the throw as a render error; SB 9 and 10 render and report the play error.
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        storyId: id,
        problem: expect.stringContaining("flaky tag failure"),
      }),
      "story reported an error while rendering",
    );
  }, 120_000);

  it("falls back to the fixed wait on a page with no Storybook channel", async () => {
    const runner = createPlaywrightCaptureRunner();
    const log = logger();
    const started = performance.now();
    const result = await runner.render({
      buildId: "settle-3",
      storybookDir: await silentStorybook(false),
      stories: [storyOf("any--story")],
      viewports,
      logger: log as never,
    });
    expect(result.captures).toHaveLength(1);
    expect(performance.now() - started).toBeGreaterThanOrEqual(500);
    expect(log.warn).not.toHaveBeenCalled();
  }, 60_000);

  it("falls back after the timeout when the channel never announces the render", async () => {
    const runner = createPlaywrightCaptureRunner();
    const log = logger();
    const started = performance.now();
    const result = await runner.render({
      buildId: "settle-4",
      storybookDir: await silentStorybook(true),
      stories: [storyOf("any--story")],
      viewports,
      logger: log as never,
    });
    expect(result.captures).toHaveLength(1);
    expect(performance.now() - started).toBeGreaterThanOrEqual(5000);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ storyId: "any--story" }),
      expect.stringContaining("did not signal"),
    );
  }, 60_000);
});

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("Storybook tests (.test())", () => {
  it("runs each test entry in the iframe and reports pass or fail from Storybook's events", async () => {
    const runner = createPlaywrightCaptureRunner();
    const outcomes = await runner.runTests?.({
      buildId: "tests-1",
      storybookDir: staticDir,
      tests: testEntries,
      playTimeoutMs: 8000,
    });
    if (testEntries.length === 0) {
      // Storybook 8 and 9 index no test entries: nothing to run.
      expect(outcomes).toEqual([]);
      return;
    }
    const byId = new Map(outcomes?.map((o) => [o.storyId, o]));
    expect(byId.get("components-button--primary:renders-its-label")?.status).toBe("passed");
    expect(byId.get("components-button--secondary:clicks-without-error")?.status).toBe("passed");
    const failing = byId.get("components-button--secondary:fails-on-purpose");
    expect(failing?.status).toBe("failed");
    expect(failing?.error).toContain("Not the label");
    expect(outcomes).toHaveLength(testEntries.length);
  }, 120_000);

  describe("through a build", () => {
    let app: ReturnType<typeof createShelfApp>;

    beforeAll(async () => {
      const dataDir = join(tmp, "data");
      await mkdir(dataDir, { recursive: true });
      app = createShelfApp({
        database: createSqliteDatabase(join(tmp, "shelf.db")),
        storage: createLocalStorage(dataDir),
        testing: { runner: createPlaywrightCaptureRunner(), concurrency: 1 },
        config: { scratchDir: dataDir, purgeTtlDays: 30 },
      });
      await app.lifecycle.setup();
    }, 120_000);

    afterAll(async () => {
      await app.lifecycle.teardown();
    });

    async function captureWith(
      runTests: boolean,
    ): Promise<{ build: Build; snapshots: Snapshot[] }> {
      const created = await app.request("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `Tests ${String(runTests)}`, runTests }),
      });
      const project = await readJson<{ slug: string }>(created);
      const uploaded = await uploadBuild(app, project.slug, staticDir, {
        gitSha: "b".repeat(40),
        gitBranch: "feature/tests",
        message: "tests",
      });
      const build = await waitForBuild(app, project.slug, uploaded.id, [
        "reviewing",
        "approved",
        "failed",
      ]);
      const snapshots = await readJson<Snapshot[]>(
        await app.request(`/api/v1/projects/${project.slug}/builds/${build.id}/snapshots`),
      );
      return { build, snapshots };
    }

    it("stores the results and fails the build on a failing test, without snapshotting tests", async () => {
      const { build, snapshots } = await captureWith(true);
      const results = parseTestResults(build.testResults);
      expect(results).toHaveLength(testEntries.length);
      expect(snapshots.every((s) => !s.storyId.includes(":"))).toBe(true);
      if (testEntries.length === 0) {
        expect(build.status).not.toBe("failed");
        return;
      }
      expect(build.status).toBe("failed");
      expect(results.filter((r) => r.status === "failed").map((r) => r.name)).toEqual([
        "fails on purpose",
      ]);
      expect(results.filter((r) => r.status === "passed")).toHaveLength(testEntries.length - 1);
    }, 240_000);

    it("leaves tests alone unless the project turns them on", async () => {
      const { build } = await captureWith(false);
      expect(build.testResults ?? null).toBeNull();
      expect(build.status).not.toBe("failed");
    }, 240_000);
  });
});
