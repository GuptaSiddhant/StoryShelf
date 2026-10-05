import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel, SnapshotModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

type Db = ReturnType<typeof makeDatabase>["db"];

async function get(path: string, seed?: (db: Db) => Promise<void>): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await seed?.(db);
  const app = createShelfApp({
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  return await (await app.request(path)).text();
}

async function seedProject(db: Db): Promise<void> {
  const project = await new ProjectModel(db).create({ name: "Docs", gitRepository: "acme/docs" });
  await new ProjectModel(db).create({ name: "Other" });
  const build = await new BuildModel(db).create(project.id, {
    gitSha: "abc1234def",
    gitBranch: "main",
    authorName: "Ada Lovelace",
  });
  const snapshots = new SnapshotModel(db);
  const snap = await snapshots.create(project.id, build.id, {
    storyId: "a--b",
    storyName: "Primary",
    storyTitle: "Button",
    viewportName: "desktop",
    viewportWidth: 1280,
    viewportHeight: 720,
    screenshotPath: "shots/a.png",
  });
  await snapshots.update(snap.id, { status: "changed" });
}

describe("projects overview", () => {
  it("shows the setup guide expanded with copyable commands when there are no projects", async () => {
    const html = await get("/projects");
    expect(html).toContain("No projects yet");
    expect(html).toContain("<details open");
    expect(html).toContain("data-copy=");
    expect(html).not.toContain('data-filter-input="true"');
  });

  it("renders a card per project with review state, previews, and a filter", async () => {
    const html = await get("/projects", seedProject);
    expect(html).toContain("Docs");
    expect(html).toContain("1 to review");
    expect(html).toContain("No builds yet");
    expect(html).toContain("/snapshots/");
    expect(html).toContain('data-filter-input="true"');
    expect(html).toContain('data-filter-text="Docs docs acme/docs"');
    expect(html).not.toContain("<details open");
  });
});

describe("project builds list", () => {
  it("lists builds in a table with status chips and a branch select", async () => {
    const html = await get("/projects/docs/builds", seedProject);
    expect(html).toContain("<table");
    expect(html).toContain("All 1");
    expect(html).toContain('aria-label="Filter by status"');
    expect(html).toContain("All branches");
    expect(html).toContain("Ada Lovelace");
  });

  it("filters by status and offers to clear when nothing matches", async () => {
    const html = await get("/projects/docs/builds?status=failed", seedProject);
    expect(html).toContain("No builds match the current filter.");
    expect(html).toContain("Clear filters");
  });

  it("filters by branch", async () => {
    const hit = await get("/projects/docs/builds?branch=main", seedProject);
    const miss = await get("/projects/docs/builds?branch=nope", seedProject);
    expect(hit).toContain("<table");
    expect(miss).toContain("No builds match the current filter.");
  });
});
