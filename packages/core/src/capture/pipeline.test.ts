import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import type { LoggerAdapter } from "../adapters/logger.ts";
import { baselines, builds, snapshots, type Build, type Project } from "../schema.ts";
import { diffPath } from "../utils/paths.ts";
import type { StoryEntry, StorySourceAdapter, Viewport } from "./adapter.ts";
import { makeDatabase, makeStorage } from "./fake-adapters.ts";
import { runCapture, type CaptureContext, type RenderStory } from "./pipeline.ts";

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

function mockAdapter(stories: StoryEntry[]): StorySourceAdapter {
  return {
    name: "storybook",
    discover: async () => await Promise.resolve(stories),
    buildUrl: (baseUrl, storyId) => `${baseUrl}/iframe.html?id=${storyId}`,
  };
}

async function makeContext(options: {
  stories: StoryEntry[];
  renderStory: RenderStory;
}): Promise<{ ctx: CaptureContext; objects: Map<string, Buffer>; messages: string[] }> {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const messages: string[] = [];
  const logger: LoggerAdapter = {
    log: (message: string) => {
      messages.push(message);
    },
    error: (message: string) => {
      messages.push(message);
    },
  };
  await db.insert(builds, mockBuild);
  const ctx: CaptureContext = {
    db,
    storage,
    project: mockProject,
    build: mockBuild,
    storybookDir: "/shelf/storybook",
    viewports: [DEFAULT_VIEWPORT],
    adapter: mockAdapter(options.stories),
    renderStory: options.renderStory,
    logger,
  };
  return { ctx, objects, messages };
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

describe("runCapture", () => {
  it("captures the other stories and fails the build when one story fails", async () => {
    const { ctx, messages } = await makeContext({
      stories: [storyOf("a"), storyOf("b")],
      renderStory: async (story): Promise<Buffer> => {
        if (story.id === "a") {
          return await Promise.reject(new Error("render exploded"));
        }
        return await Promise.resolve(png(4, 4, [0, 255, 0]));
      },
    });

    await runCapture(ctx);

    const rows = await ctx.db.list(snapshots);
    expect(rows.map((row) => row.storyName)).toEqual(["b"]);
    expect(rows.map((row) => row.status)).toEqual(["approved"]);
    const build = await ctx.db.get(builds, "b1");
    expect(build?.status).toBe("failed");
    expect(messages).toHaveLength(1);
    expect(messages.join(" | ")).toContain('story "a"');
  });

  it("fails the build when every story fails to capture", async () => {
    const { ctx } = await makeContext({
      stories: [storyOf("a"), storyOf("b")],
      renderStory: async (): Promise<Buffer> => await Promise.reject(new Error("all broken")),
    });

    await runCapture(ctx);

    expect(await ctx.db.list(snapshots)).toEqual([]);
    const build = await ctx.db.get(builds, "b1");
    expect(build?.status).toBe("failed");
  });

  it("approves a build whose stories all capture without diffs", async () => {
    const { ctx } = await makeContext({
      stories: [storyOf("a"), storyOf("b")],
      renderStory: async () => await Promise.resolve(png(4, 4, [0, 255, 0])),
    });

    await runCapture(ctx);

    const rows = await ctx.db.list(snapshots);
    expect(rows.map((row) => row.storyName)).toEqual(["a", "b"]);
    expect(rows.map((row) => row.status)).toEqual(["approved", "approved"]);
    const build = await ctx.db.get(builds, "b1");
    expect(build?.status).toBe("approved");
  });

  it("fails the diff without writing an overlay when only the size changed", async () => {
    const { ctx } = await makeContext({
      stories: [storyOf("a")],
      renderStory: async () => await Promise.resolve(png(4, 3, [0, 255, 0])),
    });
    await seedBaseline(ctx);

    await runCapture(ctx);

    const rows = await ctx.db.list(snapshots);
    expect(rows.map((row) => row.status)).toEqual(["changed"]);
    expect(rows.map((row) => row.diffPath)).toEqual([null]);
    const expectedDiff = diffPath(ctx.project.id, ctx.build.id, "a", DEFAULT_VIEWPORT.name);
    await expect(ctx.storage.exists(expectedDiff)).resolves.toBe(false);
    const build = await ctx.db.get(builds, "b1");
    expect(build?.status).toBe("reviewing");
  });
});