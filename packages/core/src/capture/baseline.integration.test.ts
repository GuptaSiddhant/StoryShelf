import { describe, expect, it } from "vitest";

import { makeDatabase, makeStorage } from "./fake-adapters.ts";
import { BaselineModel } from "../models/baseline.ts";
import { baselines, projects, type Project } from "../schema.ts";

describe("Branch baseline fallback", () => {
  const mockProject: Project = {
    id: "p1",
    name: "Test Project",
    slug: "test-project",
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

  it("resolves baseline for same branch", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(projects, mockProject);

    const baselineModel = new BaselineModel(db, storage);
    await db.insert(baselines, {
      id: "bl1",
      projectId: "p1",
      storyId: "story-1",
      viewportName: "desktop",
      branch: "main",
      snapshotId: "snap1",
      screenshotPath: "/baselines/main/story-1/desktop.png",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const resolved = await baselineModel.resolve("p1", "story-1", "desktop", "main", "main");
    expect(resolved).not.toBeNull();
    expect(resolved?.branch).toBe("main");
  });

  it("falls back to default branch when no baseline for current branch", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(projects, mockProject);

    const baselineModel = new BaselineModel(db, storage);
    await db.insert(baselines, {
      id: "bl1",
      projectId: "p1",
      storyId: "story-1",
      viewportName: "desktop",
      branch: "main",
      snapshotId: "snap1",
      screenshotPath: "/baselines/main/story-1/desktop.png",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const resolved = await baselineModel.resolve("p1", "story-1", "desktop", "feature-branch", "main");
    expect(resolved).not.toBeNull();
    expect(resolved?.branch).toBe("main");
  });

  it("returns null when no baseline exists", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(projects, mockProject);

    const baselineModel = new BaselineModel(db, storage);

    const resolved = await baselineModel.resolve("p1", "story-1", "desktop", "main", "main");
    expect(resolved).toBeNull();
  });

  it("prefers branch-specific baseline over default branch", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(projects, mockProject);

    const baselineModel = new BaselineModel(db, storage);
    await db.insert(baselines, {
      id: "bl-main",
      projectId: "p1",
      storyId: "story-1",
      viewportName: "desktop",
      branch: "main",
      snapshotId: "snap-main",
      screenshotPath: "/baselines/main/story-1/desktop.png",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.insert(baselines, {
      id: "bl-feature",
      projectId: "p1",
      storyId: "story-1",
      viewportName: "desktop",
      branch: "feature-branch",
      snapshotId: "snap-feature",
      screenshotPath: "/baselines/feature-branch/story-1/desktop.png",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const resolved = await baselineModel.resolve("p1", "story-1", "desktop", "feature-branch", "main");
    expect(resolved).not.toBeNull();
    expect(resolved?.branch).toBe("feature-branch");
  });
});
