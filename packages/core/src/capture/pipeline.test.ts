import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { RenderedSnapshot } from "../adapters/capture-runner.ts";
import type { Baseline } from "../schema/baseline.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { diffPath } from "../utils/paths.ts";
import type { StoryEntry, Viewport } from "./adapter.ts";
import { persistCapture, type CaptureContext } from "./pipeline.ts";

const DEFAULT_VIEWPORT: Viewport = { name: "mobile", width: 320, height: 480 };

const mockProject: Project = {
  id: "p1",
  name: "Fixture",
  slug: "fixture",
  gitRepository: null,
  gitDefaultBranch: "main",
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  publicBranchRegex: null,
  executePlay: false,
  playTimeoutMs: 10_000,
  storybookMeta: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const mockBuild: Build = {
  id: "b1",
  projectId: "p1",
  gitSha: "sha-1",
  gitBranch: "main",
  isDefault: true,
  authorEmail: null,
  authorName: null,
  message: null,
  public: false,
  status: "capturing",
  snapshotCount: 0,
  changedCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
  affectedOnly: true,
  baselineSha: null,
  changedFiles: null,
  affectedImportPaths: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function storyOf(id: string): StoryEntry {
  return {
    id,
    title: "Components/Button",
    name: id,
    type: "story",
  };
}

function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const [red, green, blue] = rgb;
  const image = new PNG({ width, height });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = red;
    image.data[index + 1] = green;
    image.data[index + 2] = blue;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

function captureFor(story: StoryEntry, screenshot: Buffer): RenderedSnapshot {
  return { story, viewportName: DEFAULT_VIEWPORT.name, screenshot };
}

function captureOn(browser: "chromium" | "firefox", shot: Buffer): RenderedSnapshot {
  return { ...captureFor(storyOf("a"), shot), browser };
}

async function makeContext(options: {
  captures: RenderedSnapshot[];
  isDefault?: boolean;
}): Promise<{ ctx: CaptureContext; objects: Map<string, Buffer> }> {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const build: Build = { ...mockBuild, isDefault: options.isDefault ?? true };
  await db.insert(db.tables.builds, build);
  const ctx: CaptureContext = {
    db,
    tables: {
      builds: db.tables.builds,
      buildLabels: db.tables.buildLabels,
      snapshots: db.tables.snapshots,
      baselines: db.tables.baselines,
    },
    storage,
    project: mockProject,
    build,
    viewports: [DEFAULT_VIEWPORT],
    captures: options.captures,
  };
  return { ctx, objects };
}

async function seedBaseline(ctx: CaptureContext): Promise<void> {
  const path = "/baselines/bl1.png";
  await ctx.db.insert(ctx.db.tables.baselines, {
    id: "bl1",
    projectId: ctx.project.id,
    storyId: "a",
    viewportName: DEFAULT_VIEWPORT.name,
    branch: ctx.build.gitBranch,
    snapshotId: "snap1",
    screenshotPath: path,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  await ctx.storage.write(path, png(4, 4, [255, 0, 0]));
}

describe("persistCapture", () => {
  describe("multiple browsers", () => {
    const RED = png(4, 4, [255, 0, 0]);
    const GREEN = png(4, 4, [0, 255, 0]);

    it("keeps one baseline per engine and per-engine storage paths", async () => {
      const { ctx, objects } = await makeContext({
        captures: [captureOn("chromium", RED), captureOn("firefox", GREEN)],
      });
      await persistCapture({ ...ctx, browsers: ["chromium", "firefox"] });

      const rows = await ctx.db.list(ctx.db.tables.snapshots);
      expect(rows.map((row) => row.browser)).toEqual(
        expect.arrayContaining(["chromium", "firefox"]),
      );
      expect(rows).toHaveLength(2);
      const baselines = await ctx.db.list(ctx.db.tables.baselines);
      expect(baselines.map((row) => row.browser)).toEqual(
        expect.arrayContaining(["chromium", "firefox"]),
      );
      expect(baselines).toHaveLength(2);
      expect(objects.has("p1/baselines/main/a/mobile.png")).toBe(true);
      expect(objects.has("p1/baselines/main/a/mobile~firefox.png")).toBe(true);
    });

    it("diffs each engine only against its own baseline", async () => {
      const { ctx } = await makeContext({
        captures: [captureOn("chromium", RED), captureOn("firefox", GREEN)],
        isDefault: false,
      });
      await ctx.db.insert(ctx.db.tables.baselines, {
        id: "c1",
        projectId: "p1",
        storyId: "a",
        viewportName: "mobile",
        browser: "chromium",
        branch: "main",
        screenshotPath: "/b/chromium.png",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      await ctx.storage.write("/b/chromium.png", RED);

      await persistCapture({ ...ctx, browsers: ["chromium", "firefox"] });

      const rows = await ctx.db.list(ctx.db.tables.snapshots);
      const status = Object.fromEntries(rows.map((row) => [row.browser, row.status]));
      // chromium matches its baseline; firefox has none, and is not fresh-bootstrapped
      // because chromium already has baselines but firefox has none -> bootstrap applies.
      expect(status["chromium"]).toBe("unchanged");
      expect(status["firefox"]).toBe("approved");
    });

    it("bootstraps a newly enabled engine only where the primary is clean", async () => {
      const { ctx } = await makeContext({
        captures: [
          captureOn("chromium", RED),
          captureOn("firefox", GREEN),
          { ...captureFor(storyOf("b"), RED), browser: "chromium" },
          { ...captureFor(storyOf("b"), GREEN), browser: "firefox" },
        ],
        isDefault: false,
      });
      // story a: primary unchanged (baseline matches); story b: primary changed.
      await ctx.db.insert(ctx.db.tables.baselines, {
        id: "ca",
        projectId: "p1",
        storyId: "a",
        viewportName: "mobile",
        browser: "chromium",
        branch: "main",
        screenshotPath: "/b/a.png",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      await ctx.storage.write("/b/a.png", RED);
      await ctx.db.insert(ctx.db.tables.baselines, {
        id: "cb",
        projectId: "p1",
        storyId: "b",
        viewportName: "mobile",
        browser: "chromium",
        branch: "main",
        screenshotPath: "/b/b.png",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      await ctx.storage.write("/b/b.png", GREEN);

      await persistCapture({ ...ctx, browsers: ["chromium", "firefox"] });

      const rows = await ctx.db.list(ctx.db.tables.snapshots);
      const firefox = Object.fromEntries(
        rows.filter((row) => row.browser === "firefox").map((row) => [row.storyId, row.status]),
      );
      expect(firefox).toEqual({ a: "approved", b: "new" });
    });

    it("does not bootstrap once the engine already has baselines", async () => {
      const { ctx } = await makeContext({
        captures: [captureOn("chromium", RED), captureOn("firefox", GREEN)],
        isDefault: false,
      });
      await ctx.db.insert(ctx.db.tables.baselines, {
        id: "f0",
        projectId: "p1",
        storyId: "other",
        viewportName: "mobile",
        browser: "firefox",
        branch: "main",
        screenshotPath: "/b/other.png",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      await persistCapture({ ...ctx, browsers: ["chromium", "firefox"] });

      const rows = await ctx.db.list(ctx.db.tables.snapshots);
      const firefox = rows.find((row) => row.browser === "firefox");
      expect(firefox?.status).toBe("new");
    });
  });

  it("persists a mode's globals on the snapshot and its default-branch baseline", async () => {
    const dark: Viewport = { name: "dark", width: 320, height: 480, globals: { theme: "dark" } };
    const { ctx } = await makeContext({
      captures: [
        {
          story: storyOf("a"),
          viewportName: "dark",
          viewport: dark,
          screenshot: png(4, 4, [0, 0, 0]),
        },
        captureFor(storyOf("a"), png(4, 4, [255, 255, 255])),
      ],
    });

    await persistCapture(ctx, new Set());

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    const byViewport = Object.fromEntries(rows.map((row) => [row.viewportName, row.mode]));
    expect(byViewport).toEqual({ dark: '{"theme":"dark"}', mobile: null });
    const baselines = await ctx.db.list(ctx.db.tables.baselines);
    expect(
      Object.fromEntries(baselines.map((baseline) => [baseline.viewportName, baseline.mode])),
    ).toEqual({ dark: '{"theme":"dark"}', mobile: null });
  });

  it("stores the story's design url on new and diffed snapshots", async () => {
    const figma = "https://www.figma.com/design/KEY/Kit?node-id=1-2";
    const story: StoryEntry = { ...storyOf("a"), importPath: "./A.stories.tsx", designUrl: figma };
    const { ctx } = await makeContext({
      captures: [
        captureFor(story, png(4, 4, [0, 255, 0])),
        captureFor(storyOf("b"), png(4, 4, [0, 255, 0])),
      ],
    });
    await seedBaseline(ctx);

    await persistCapture(ctx);

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    expect(rows.find((row) => row.storyName === "a")?.designUrl).toBe(figma);
    expect(rows.find((row) => row.storyName === "b")?.designUrl).toBeNull();
  });

  it("persists the captured stories and fails the build when a story failed to render", async () => {
    const { ctx } = await makeContext({
      captures: [captureFor(storyOf("b"), png(4, 4, [0, 255, 0]))],
    });

    await persistCapture(ctx, new Set(["a"]));

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    expect(rows.map((row) => row.storyName)).toEqual(["b"]);
    expect(rows.map((row) => row.status)).toEqual(["approved"]);
    const build = await ctx.db.get(ctx.db.tables.builds, "b1");
    expect(build?.status).toBe("failed");
  });

  it("fails the build when every story failed to render", async () => {
    const { ctx } = await makeContext({ captures: [] });

    await persistCapture(ctx, new Set(["a", "b"]));

    expect(await ctx.db.list(ctx.db.tables.snapshots)).toEqual([]);
    const build = await ctx.db.get(ctx.db.tables.builds, "b1");
    expect(build?.status).toBe("failed");
  });

  it("approves a build whose captures all persist without diffs", async () => {
    const { ctx } = await makeContext({
      captures: [
        captureFor(storyOf("a"), png(4, 4, [0, 255, 0])),
        captureFor(storyOf("b"), png(4, 4, [0, 255, 0])),
      ],
    });

    await persistCapture(ctx);

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    expect(rows.map((row) => row.storyName)).toEqual(["a", "b"]);
    expect(rows.map((row) => row.status)).toEqual(["approved", "approved"]);
    const build = await ctx.db.get(ctx.db.tables.builds, "b1");
    expect(build?.status).toBe("approved");
  });

  it("fails the diff without writing an overlay when only the size changed", async () => {
    const { ctx } = await makeContext({
      captures: [captureFor(storyOf("a"), png(4, 3, [0, 255, 0]))],
      isDefault: false,
    });
    await seedBaseline(ctx);

    await persistCapture(ctx);

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    expect(rows.map((row) => row.status)).toEqual(["changed"]);
    expect(rows.map((row) => row.diffPath)).toEqual([null]);
    const expectedDiff = diffPath(ctx.project.id, ctx.build.id, "a", DEFAULT_VIEWPORT.name);
    await expect(ctx.storage.exists(expectedDiff)).resolves.toBe(false);
    const build = await ctx.db.get(ctx.db.tables.builds, "b1");
    expect(build?.status).toBe("reviewing");
  });

  it("auto-approves changed snapshots on the default branch and re-baselines", async () => {
    const { ctx } = await makeContext({
      captures: [captureFor(storyOf("a"), png(4, 4, [0, 255, 0]))],
    });
    await seedBaseline(ctx);

    await persistCapture(ctx);

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    expect(rows.map((row) => row.status)).toEqual(["approved"]);
    expect(rows.map((row) => row.diffPassed)).toEqual([false]);
    const build = await ctx.db.get(ctx.db.tables.builds, "b1");
    expect(build?.status).toBe("approved");
    const baselines = await ctx.db.list(ctx.db.tables.baselines);
    expect(baselines).toHaveLength(1);
    expect(baselines[0]?.snapshotId).toBe(rows[0]?.id);
  });

  it("keeps changed snapshots in review on a feature branch", async () => {
    const { ctx } = await makeContext({
      captures: [captureFor(storyOf("a"), png(4, 4, [0, 255, 0]))],
      isDefault: false,
    });
    await seedBaseline(ctx);

    await persistCapture(ctx);

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    expect(rows.map((row) => row.status)).toEqual(["changed"]);
    const build = await ctx.db.get(ctx.db.tables.builds, "b1");
    expect(build?.status).toBe("reviewing");
    const baselines = await ctx.db.list(ctx.db.tables.baselines);
    expect(baselines[0]?.snapshotId).toBe("snap1");
  });

  it("relaxes the pixel threshold for a story with a diffThreshold override", async () => {
    const relaxed: StoryEntry = { ...storyOf("a"), parameters: { diffThreshold: 1 } };
    const { ctx } = await makeContext({
      captures: [captureFor(relaxed, png(4, 4, [0, 255, 0]))],
      isDefault: false,
    });
    await seedBaseline(ctx);

    await persistCapture(ctx);

    const [row] = await ctx.db.list(ctx.db.tables.snapshots);
    expect(row?.status).toBe("unchanged");
    expect(row?.diffPassed).toBe(true);
  });

  it("applies diffThreshold to its own snapshot only", async () => {
    const relaxed: StoryEntry = { ...storyOf("a"), parameters: { diffThreshold: 1 } };
    const { ctx } = await makeContext({
      captures: [
        captureFor(relaxed, png(4, 4, [0, 255, 0])),
        captureFor(storyOf("c"), png(4, 4, [0, 255, 0])),
      ],
      isDefault: false,
    });
    await seedBaseline(ctx);
    await ctx.db.insert(ctx.db.tables.baselines, {
      id: "bl2",
      projectId: ctx.project.id,
      storyId: "c",
      viewportName: DEFAULT_VIEWPORT.name,
      branch: ctx.build.gitBranch,
      snapshotId: "snap2",
      screenshotPath: "/baselines/bl1.png",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await persistCapture(ctx);

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    const byStory = new Map(rows.map((row) => [row.storyName, row.status]));
    expect(byStory.get("a")).toBe("unchanged");
    expect(byStory.get("c")).toBe("changed");
  });

  it("ignores an out-of-range diffThreshold and uses the project threshold", async () => {
    const invalid: StoryEntry = { ...storyOf("a"), parameters: { diffThreshold: 5 } };
    const { ctx } = await makeContext({
      captures: [captureFor(invalid, png(4, 4, [0, 255, 0]))],
      isDefault: false,
    });
    await seedBaseline(ctx);

    await persistCapture(ctx);

    const [row] = await ctx.db.list(ctx.db.tables.snapshots);
    expect(row?.status).toBe("changed");
  });

  it("approves a default-branch build with no captures", async () => {
    const { ctx } = await makeContext({ captures: [] });

    await persistCapture(ctx, new Set());

    const build = await ctx.db.get(ctx.db.tables.builds, "b1");
    expect(build?.status).toBe("approved");
  });

  it("records the baseline a snapshot was diffed against", async () => {
    const { ctx } = await makeContext({
      captures: [captureFor(storyOf("a"), png(4, 4, [0, 255, 0]))],
      isDefault: false,
    });
    await seedBaseline(ctx);

    await persistCapture(ctx);

    const [row] = await ctx.db.list(ctx.db.tables.snapshots);
    expect(row?.baselineId).toBe("bl1");
    expect(row?.baselineVersion).toBe("2026-01-01T00:00:00.000Z");
  });

  it("marks snapshots of stories without a baseline as diffed against none", async () => {
    const { ctx } = await makeContext({
      captures: [captureFor(storyOf("a"), png(4, 4, [0, 255, 0]))],
    });

    await persistCapture(ctx);

    const [row] = await ctx.db.list(ctx.db.tables.snapshots);
    expect(row?.baselineId).toBeNull();
    expect(row?.baselineVersion).toBe("none");
  });

  it("keeps a feature-branch build in reviewing status when no captures occur", async () => {
    const { ctx } = await makeContext({ captures: [], isDefault: false });

    await persistCapture(ctx, new Set());

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    expect(rows).toEqual([]);
    const build = await ctx.db.get(ctx.db.tables.builds, "b1");
    expect(build?.status).toBe("reviewing");
  });

  it("inherits unaffected stories from their baseline without rendering", async () => {
    const { ctx } = await makeContext({ captures: [] });
    await seedBaseline(ctx);
    const baseline = (await ctx.db.get(
      ctx.db.tables.baselines,
      "bl1",
    )) as unknown as Baseline | null;
    if (!baseline) {
      throw new Error("baseline must exist");
    }

    await persistCapture({
      ...ctx,
      inherited: [{ story: storyOf("a"), viewport: DEFAULT_VIEWPORT, baseline }],
    });

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    expect(rows.map((row) => row.storyName)).toEqual(["a"]);
    expect(rows.map((row) => row.status)).toEqual(["unchanged"]);
    expect(rows.map((row) => row.inherited)).toEqual([true]);
    expect(rows.map((row) => row.screenshotPath)).toEqual(["/baselines/bl1.png"]);
    const build = await ctx.db.get(ctx.db.tables.builds, "b1");
    expect(build?.status).toBe("approved");
  });

  it("mixes rendered and inherited snapshots in one build", async () => {
    const { ctx } = await makeContext({
      captures: [captureFor(storyOf("b"), png(4, 4, [0, 255, 0]))],
    });
    await seedBaseline(ctx);
    const baseline = (await ctx.db.get(
      ctx.db.tables.baselines,
      "bl1",
    )) as unknown as Baseline | null;
    if (!baseline) {
      throw new Error("baseline must exist");
    }

    await persistCapture({
      ...ctx,
      inherited: [{ story: storyOf("a"), viewport: DEFAULT_VIEWPORT, baseline }],
    });

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    const byStory = new Map(rows.map((row) => [row.storyName, row] as const));
    expect(byStory.get("a")?.status).toBe("unchanged");
    expect(byStory.get("b")?.status).toBe("approved");
    expect(byStory.get("a")?.inherited).toBe(true);
    const build = await ctx.db.get(ctx.db.tables.builds, "b1");
    expect(build?.status).toBe("approved");
    expect(build?.snapshotCount).toBe(2);
  });

  it("uses the renderer's viewport dims for a story-only viewport not in the project list", async () => {
    const tablet: Viewport = { name: "tablet", width: 834, height: 1112 };
    const { ctx } = await makeContext({
      captures: [
        {
          story: storyOf("a"),
          viewportName: tablet.name,
          viewport: tablet,
          screenshot: png(4, 4, [0, 255, 0]),
        },
      ],
    });

    await persistCapture(ctx);

    const rows = await ctx.db.list(ctx.db.tables.snapshots);
    const row = rows.find((snapshot) => snapshot.storyId === "a");
    expect(row?.viewportName).toBe("tablet");
    expect(row?.viewportWidth).toBe(834);
    expect(row?.viewportHeight).toBe(1112);
  });
});
