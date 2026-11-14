import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CaptureRunner, RenderResult } from "../adapters/capture-runner.ts";
import { TargetLaunchError } from "../adapters/capture-target.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { contentPath } from "../utils/paths.ts";
import type { StoryEntry, Viewport } from "./adapter.ts";
import {
  captureAcrossBrowsers,
  partitionBrowsers,
  renderWork,
  type MatrixInput,
} from "./matrix.ts";

const VIEWPORT: Viewport = { name: "desktop", width: 1280, height: 720 };

function png(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(100),
  ]);
}

function story(id: string, extra: Partial<StoryEntry> = {}): StoryEntry {
  return {
    id,
    title: "Components/Thing",
    name: id,
    importPath: `./${id}.stories.tsx`,
    type: "story",
    ...extra,
  };
}

type RenderInput = Parameters<CaptureRunner["render"]>[0];

/** A runner that captures every story it is given, one screenshot each, and remembers its calls. */
function runnerOf(behaviour?: (input: RenderInput) => Promise<RenderResult | undefined>): {
  runner: CaptureRunner;
  calls: RenderInput[];
} {
  const calls: RenderInput[] = [];
  const runner: CaptureRunner = {
    metadata: { name: "Fake", version: "0.0.0", kind: "fake", category: "capture-runner" },
    cancel: async () => {},
    render: async (input) => {
      calls.push(input);
      const custom = await behaviour?.(input);
      if (custom) return custom;
      for (const entry of input.stories) {
        // oxlint-disable-next-line no-await-in-loop -- one capture at a time, like a page pool of 1
        await input.onCapture?.({ story: entry, viewportName: "desktop", screenshot: png() });
      }
      return { captures: [], failures: [] };
    },
  };
  return { runner, calls };
}

function setup(overrides: Partial<MatrixInput> = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const { runner, calls } = runnerOf();
  const logged: { level: string; message: string; fields: unknown }[] = [];
  const input: MatrixInput = {
    db,
    storage,
    tables: {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      snapshots: db.tables.snapshots,
      baselines: db.tables.baselines,
    } as MatrixInput["tables"],
    runner,
    build: { id: "build-1", gitBranch: "feature" } as Build,
    project: { id: "p1", gitDefaultBranch: "main", browsers: '["chromium","firefox"]' } as Project,
    stories: [story("a"), story("b")],
    viewports: [VIEWPORT],
    storybookDir: "/tmp/storybook",
    browsers: ["chromium", "firefox"],
    affectedPaths: null,
    logger: undefined,
    recordLog: async (level, message, fields) => {
      await Promise.resolve();
      logged.push({ level, message, fields });
    },
    ...overrides,
  };
  return { db, storage, input, calls, logged };
}

async function seedBaseline(db: ReturnType<typeof makeDatabase>["db"], storyId: string) {
  await db.insert(db.tables.baselines, {
    id: `bl-${storyId}`,
    projectId: "p1",
    storyId,
    viewportName: VIEWPORT.name,
    branch: "main",
    snapshotId: null,
    screenshotPath: `/baselines/${storyId}.png`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("captureAcrossBrowsers", () => {
  it("renders each engine in order, tags every capture with its engine and sums the renders", async () => {
    const { input, calls } = setup();
    const result = await captureAcrossBrowsers(input);
    expect(calls.map((call) => call.target)).toEqual(["chromium", "firefox"]);
    expect(result.captures.map((capture) => capture.browser)).toEqual([
      "chromium",
      "chromium",
      "firefox",
      "firefox",
    ]);
    expect(result.renderCount).toBe(4);
    expect(result.failures).toEqual([]);
    expect(result.inherited).toEqual([]);
  });

  it("tags the failures and the captures a runner returns, not only the ones it streams", async () => {
    const { runner } = runnerOf(async (render) => {
      await Promise.resolve();
      const [first, second] = render.stories;
      if (!first || !second) return { captures: [], failures: [] };
      return {
        captures: [{ story: first, viewportName: "desktop", screenshot: png() }],
        failures: [{ storyId: second.id, viewportName: "desktop", error: "render failed" }],
      };
    });
    const { input } = setup({ runner });
    const result = await captureAcrossBrowsers(input);
    expect(result.failures.map((failure) => failure.browser)).toEqual(["chromium", "firefox"]);
    expect(result.captures.map((capture) => capture.browser)).toEqual(["chromium", "firefox"]);
  });

  it("never has two engines rendering at once", async () => {
    let running = 0;
    let peak = 0;
    const { runner } = runnerOf(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return { captures: [], failures: [] };
    });
    await captureAcrossBrowsers(setup({ runner }).input);
    expect(peak).toBe(1);
  });

  it("stores each screenshot as it is taken and keeps only its metadata", async () => {
    const { input, storage } = setup({ browsers: ["chromium"] });
    const result = await captureAcrossBrowsers(input);
    const first = result.captures[0];
    expect(first).toMatchObject({ stored: true, browser: "chromium" });
    expect(first?.screenshot.length).toBe(0);
    expect(first?.storedPath).toBeTruthy();
    expect(await storage.exists(first?.storedPath ?? "")).toBe(true);
  });

  it("identifies the run to the runner: the build id by default, the shard when given", async () => {
    const plain = setup({ browsers: ["chromium"] });
    await captureAcrossBrowsers(plain.input);
    expect(plain.calls[0]).toMatchObject({ buildId: "build-1", runId: "build-1" });
    expect(plain.calls[0]).not.toHaveProperty("shardIndex");
    const shard = setup({ browsers: ["chromium"], runId: "shard-7", shardIndex: 3 });
    await captureAcrossBrowsers(shard.input);
    expect(shard.calls[0]).toMatchObject({ runId: "shard-7", shardIndex: 3 });
  });

  it("asks for accessibility checks on the primary engine only", async () => {
    const { input, calls } = setup();
    await captureAcrossBrowsers(input);
    expect(calls.map((call) => [call.target, call.runA11y])).toEqual([
      ["chromium", true],
      ["firefox", false],
    ]);
  });

  it("calls the progress hook for every screenshot and logs a line every ten", async () => {
    const progress = vi.fn();
    const stories = Array.from({ length: 10 }, (_unused, index) => story(`s${index}`));
    const { input, logged } = setup({ browsers: ["chromium"], stories, progress });
    await captureAcrossBrowsers(input);
    expect(progress).toHaveBeenCalledTimes(10);
    expect(logged.map((line) => line.message)).toContain("captured 10/10 screenshots");
  });

  it("records the partition and the finished pass for every engine", async () => {
    const { input, logged } = setup();
    await captureAcrossBrowsers(input);
    const messages = logged.map((line) => line.message);
    expect(messages.filter((message) => message === "affected capture partitioned")).toHaveLength(
      2,
    );
    expect(messages.filter((message) => message === "render pass finished")).toHaveLength(2);
  });

  it("inherits a story that has a baseline and renders only the one that has not", async () => {
    const { input, calls, db } = setup({
      browsers: ["chromium"],
      affectedPaths: ["./unrelated.tsx"],
    });
    await seedBaseline(db, "a");
    const result = await captureAcrossBrowsers(input);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.stories.map((entry) => entry.id)).toEqual(["b"]);
    expect(result.inherited).toHaveLength(1);
    expect(result.inherited[0]).toMatchObject({ browser: "chromium" });
    expect(result.inherited[0]?.story.id).toBe("a");
    expect(result.renderCount).toBe(1);
  });

  it("does not start a render when every story inherits", async () => {
    const { input, calls, db } = setup({ browsers: ["chromium"], affectedPaths: ["./x.tsx"] });
    await seedBaseline(db, "a");
    await seedBaseline(db, "b");
    const result = await captureAcrossBrowsers(input);
    expect(calls).toEqual([]);
    expect(result).toMatchObject({ captures: [], renderCount: 0 });
    expect(result.inherited).toHaveLength(2);
  });

  it("does nothing for a build with no stories: no render, no captures, no error", async () => {
    const { input, calls } = setup({ stories: [] });
    const result = await captureAcrossBrowsers(input);
    expect(calls).toEqual([]);
    expect(result).toEqual({ captures: [], failures: [], inherited: [], renderCount: 0 });
  });

  it("lets a launch failure through, without isolating or retrying", async () => {
    const { runner, calls } = runnerOf(async () => {
      await Promise.resolve();
      throw new TargetLaunchError("firefox", "no binary");
    });
    const { input } = setup({ runner, browsers: ["firefox"] });
    await expect(captureAcrossBrowsers(input)).rejects.toBeInstanceOf(TargetLaunchError);
    expect(calls).toHaveLength(1);
  });

  it("keeps what was captured before a crash and fails only the story that crashes alone", async () => {
    const { runner } = runnerOf(async (render) => {
      for (const entry of render.stories) {
        if (entry.id === "b") throw new Error("browser exploded");
        // oxlint-disable-next-line no-await-in-loop -- one capture at a time
        await render.onCapture?.({ story: entry, viewportName: "desktop", screenshot: png() });
      }
      return { captures: [], failures: [] };
    });
    const stories = [story("a"), story("b"), story("c")];
    const { input } = setup({ runner, stories, browsers: ["chromium"] });
    const result = await captureAcrossBrowsers(input);
    const captured = result.captures.map((capture) => capture.story.id);
    expect(captured).toHaveLength(2);
    expect(captured).toEqual(expect.arrayContaining(["a", "c"]));
    expect(result.failures.map((failure) => failure.storyId)).toEqual(["b"]);
  });

  it("logs a failed flaky story as a warning and a failed ordinary one as an error", async () => {
    const stories = [story("flaky", { tags: ["flaky-test"] }), story("solid")];
    const { runner } = runnerOf(async (render) => {
      render.logger?.error({ storyId: "flaky" }, "story failed");
      render.logger?.error({ storyId: "solid" }, "story failed");
      await Promise.resolve();
      return { captures: [], failures: [] };
    });
    const { input, logged } = setup({ runner, stories, browsers: ["chromium"] });
    await captureAcrossBrowsers(input);
    const levelOf = (storyId: string) =>
      logged.find(
        (line) =>
          line.message === "story failed" &&
          (line.fields as { storyId?: string } | undefined)?.storyId === storyId,
      )?.level;
    expect(levelOf("flaky")).toBe("warn");
    expect(levelOf("solid")).toBe("error");
  });
});

/** Where a screenshot of these bytes is stored: content-addressed, as `storeScreenshot` does. */
function pathOf(bytes: Buffer): string {
  return contentPath("p1", createHash("sha256").update(bytes).digest("hex"));
}

/** A baseline whose image is at `path`. */
async function seedAt(db: ReturnType<typeof makeDatabase>["db"], storyId: string, path: string) {
  await seedBaseline(db, storyId);
  await db.update(db.tables.baselines, `bl-${storyId}`, { screenshotPath: path });
}

describe("story switching (ADR 0052, decision 5)", () => {
  it("asks the runner to switch only to baselined stories, then confirms on fresh pages", async () => {
    const same = png();
    const other = Buffer.concat([png(), Buffer.from([1])]);
    const { input, calls, db, logged } = setup({
      browsers: ["chromium"],
      stories: [story("a"), story("b"), story("c")],
      switchStories: true,
    });
    await seedAt(db, "a", pathOf(same));
    await seedAt(db, "b", pathOf(same));
    const { runner } = runnerOf(async (request) => {
      for (const entry of request.stories) {
        const switched = request.switchStories !== undefined && entry.id !== "c";
        // oxlint-disable-next-line no-await-in-loop -- one capture at a time
        await request.onCapture?.({
          story: entry,
          viewportName: "desktop",
          screenshot: entry.id === "b" && switched ? other : same,
          ...(switched ? { switched: true } : {}),
        });
      }
      calls.push(request);
      return { captures: [], failures: [] };
    });
    const result = await captureAcrossBrowsers({ ...input, runner });
    expect(calls[0]?.switchStories?.baselined.map((pair) => pair.storyId)).toEqual(["a", "b"]);
    // b's switched capture differs from its baseline: rendered again, without switching.
    expect(calls[1]?.switchStories).toBeUndefined();
    expect(calls[1]?.stories.map((entry) => entry.id)).toEqual(["b"]);
    const byStory = new Map(result.captures.map((capture) => [capture.story.id, capture]));
    expect(byStory.get("a")?.switched).toBe(true);
    expect(byStory.get("b")?.switched).toBeUndefined();
    expect(byStory.get("b")?.storedPath).toBe(pathOf(same));
    expect(result.captures).toHaveLength(3);
    expect(logged.find((line) => line.message.startsWith("story switching"))?.fields).toMatchObject(
      {
        switched: 2,
        renderedAgain: 1,
      },
    );
  });

  it("sends no request when the build does not switch", async () => {
    const { input, calls } = setup({ browsers: ["chromium"] });
    await captureAcrossBrowsers(input);
    expect(calls[0]?.switchStories).toBeUndefined();
  });
});

describe("partitionBrowsers", () => {
  it("lists every story for every engine when nothing is affected-only, and renders nothing", async () => {
    const { input, calls } = setup();
    const partition = await partitionBrowsers(input);
    expect(partition.work.map((entry) => entry.browser)).toEqual(["chromium", "firefox"]);
    for (const entry of partition.work) {
      expect(entry.stories.map((candidate) => candidate.id)).toEqual(["a", "b"]);
    }
    expect(partition.inherited).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("plans an empty slice for every engine when there are no stories", async () => {
    const { input, calls } = setup({ stories: [] });
    const partition = await partitionBrowsers(input);
    expect(partition.work).toEqual([
      { browser: "chromium", stories: [] },
      { browser: "firefox", stories: [] },
    ]);
    expect(partition.inherited).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("decides per engine: a baseline for one engine does not spare the other", async () => {
    const { input, db } = setup({ affectedPaths: ["./unrelated.tsx"] });
    await seedBaseline(db, "a");
    const partition = await partitionBrowsers(input);
    const byBrowser = Object.fromEntries(
      partition.work.map((entry) => [entry.browser, entry.stories.map((s) => s.id)]),
    );
    expect(byBrowser).toEqual({ chromium: ["b"], firefox: ["a", "b"] });
    expect(partition.inherited.map((item) => [item.story.id, item.browser])).toEqual([
      ["a", "chromium"],
    ]);
  });
});

describe("renderWork", () => {
  it("renders exactly the slice it is given for each engine, and inherits nothing", async () => {
    const { input, calls, db } = setup({ affectedPaths: ["./unrelated.tsx"] });
    await seedBaseline(db, "a");
    const result = await renderWork(input, [
      { browser: "chromium", stories: [story("a")] },
      { browser: "firefox", stories: [story("b")] },
    ]);
    expect(calls.map((call) => [call.target, call.stories.map((entry) => entry.id)])).toEqual([
      ["chromium", ["a"]],
      ["firefox", ["b"]],
    ]);
    expect(result.inherited).toEqual([]);
    expect(result.renderCount).toBe(2);
    expect(result.captures.map((capture) => capture.browser)).toEqual(["chromium", "firefox"]);
  });

  it("writes the lines logged before a launch failure to the attempt log, and stops there", async () => {
    const { runner, calls } = runnerOf(async (render) => {
      render.logger?.info("launching");
      await Promise.resolve();
      throw new TargetLaunchError("chromium", "no binary");
    });
    const { input, logged } = setup({ runner });
    await expect(
      renderWork(input, [
        { browser: "chromium", stories: [story("a")] },
        { browser: "firefox", stories: [story("b")] },
      ]),
    ).rejects.toBeInstanceOf(TargetLaunchError);
    expect(logged.map((line) => line.message)).toContain("launching");
    expect(calls).toHaveLength(1);
  });
});
