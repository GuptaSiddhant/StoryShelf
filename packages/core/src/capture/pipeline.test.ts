import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { RenderedSnapshot } from "../adapters/capture-runner.ts";
import { baselines } from "../schema/baseline.ts";
import { builds } from "../schema/build.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";
import { snapshots } from "../schema/snapshot.ts";
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

async function makeContext(options: {
  captures: RenderedSnapshot[];
}): Promise<{ ctx: CaptureContext; objects: Map<string, Buffer> }> {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(builds, mockBuild);
  const ctx: CaptureContext = {
    db,
    storage,
    project: mockProject,
    build: mockBuild,
    viewports: [DEFAULT_VIEWPORT],
    captures: options.captures,
  };
  return { ctx, objects };
}

async function seedBaseline(ctx: CaptureContext): Promise<void> {
  const path = "/baselines/bl1.png";
  await ctx.db.insert(baselines, {
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
  it("persists the captured stories and fails the build when a story failed to render", async () => {
    const { ctx } = await makeContext({
      captures: [captureFor(storyOf("b"), png(4, 4, [0, 255, 0]))],
    });

    await persistCapture(ctx, new Set(["a"]));

    const rows = await ctx.db.list(snapshots);
    expect(rows.map((row) => row.storyName)).toEqual(["b"]);
    expect(rows.map((row) => row.status)).toEqual(["approved"]);
    const build = await ctx.db.get(builds, "b1");
    expect(build?.status).toBe("failed");
  });

  it("fails the build when every story failed to render", async () => {
    const { ctx } = await makeContext({ captures: [] });

    await persistCapture(ctx, new Set(["a", "b"]));

    expect(await ctx.db.list(snapshots)).toEqual([]);
    const build = await ctx.db.get(builds, "b1");
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

    const rows = await ctx.db.list(snapshots);
    expect(rows.map((row) => row.storyName)).toEqual(["a", "b"]);
    expect(rows.map((row) => row.status)).toEqual(["approved", "approved"]);
    const build = await ctx.db.get(builds, "b1");
    expect(build?.status).toBe("approved");
  });

  it("fails the diff without writing an overlay when only the size changed", async () => {
    const { ctx } = await makeContext({
      captures: [captureFor(storyOf("a"), png(4, 3, [0, 255, 0]))],
    });
    await seedBaseline(ctx);

    await persistCapture(ctx);

    const rows = await ctx.db.list(snapshots);
    expect(rows.map((row) => row.status)).toEqual(["changed"]);
    expect(rows.map((row) => row.diffPath)).toEqual([null]);
    const expectedDiff = diffPath(ctx.project.id, ctx.build.id, "a", DEFAULT_VIEWPORT.name);
    await expect(ctx.storage.exists(expectedDiff)).resolves.toBe(false);
    const build = await ctx.db.get(builds, "b1");
    expect(build?.status).toBe("reviewing");
  });

  it("keeps build in reviewing status when no captures occur", async () => {
    const { ctx } = await makeContext({ captures: [] });

    await persistCapture(ctx, new Set());

    const rows = await ctx.db.list(snapshots);
    expect(rows).toEqual([]);
    const build = await ctx.db.get(builds, "b1");
    expect(build?.status).toBe("reviewing");
  });
});
