import { SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { catalogPath } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

const project: Project = {
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

const build = (status: Build["status"]): Build => ({
  id: "b1",
  projectId: "p1",
  gitSha: "sha",
  gitBranch: "main",
  isDefault: true,
  authorEmail: null,
  authorName: null,
  message: null,
  public: false,
  status,
  snapshotCount: 0,
  affectedOnly: true,
  baselineSha: null,
  changedFiles: null,
  affectedImportPaths: null,
  changedCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
  inheritedCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const entry = (id: string, type = "story") => ({
  id,
  title: "A",
  name: id,
  importPath: "a.stories.tsx",
  type,
  tags: [],
});

async function setup(status: Build["status"], testing: boolean) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, project);
  await db.insert(db.tables.builds, build(status));
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    ...(testing ? { testing: { runner: stubRunner() } } : {}),
  });
  const get = async (): Promise<Record<string, unknown>> =>
    (await (await app.request("/api/v1/projects/test-project/builds/b1")).json()) as Record<
      string,
      unknown
    >;
  return { db, storage, get };
}

describe("GET build: publishing and capture state", () => {
  it("reports publishing pending, then success once the manifest is stored", async () => {
    const { storage, get } = await setup("pending", false);
    expect(await get()).toMatchObject({ status: "pending", publishing: "pending", capture: null });
    await storage.write("p1/builds/b1/storybook/manifest.json", Buffer.from("{}"));
    expect(await get()).toMatchObject({ publishing: "success", capture: null });
  });

  it("reports stories with a snapshot over the catalog's stories while capturing", async () => {
    const { db, storage, get } = await setup("capturing", true);
    const entries = [entry("a--1"), entry("a--2"), entry("a--docs", "docs")];
    const catalogJson = JSON.stringify({ v: 1, entries });
    await storage.write(catalogPath("p1", "b1"), Buffer.from(catalogJson));
    const snapshots = new SnapshotModel(db);
    const base = {
      storyName: "n",
      storyTitle: "A",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshotPath: "x.png",
    };
    await snapshots.create("p1", "b1", { ...base, storyId: "a--1" });
    await snapshots.create("p1", "b1", { ...base, storyId: "a--1", viewportName: "mobile" });
    expect(await get()).toMatchObject({ status: "capturing", capture: { done: 1, total: 2 } });
  });

  it("reports an unknown total without a catalog", async () => {
    const { get } = await setup("capturing", true);
    expect(await get()).toMatchObject({ capture: { done: 0, total: null } });
  });
});
