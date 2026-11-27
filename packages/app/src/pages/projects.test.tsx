import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel, SnapshotModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

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
    expect(html).toMatch(/<details[^>]* open/u);
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
    expect(html).not.toMatch(/<details[^>]* open/u);
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

/** A default install's app, with sign-in on and no admin token (the CLI cannot create a project). */
async function getSignedInNoToken(path: string): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const user = { id: "user_1", email: "ada@example.com", name: "Ada", role: "admin" as const };
  const app = createShelfApp({
    database: db,
    storage,
    auth: stubAuth(user),
    logger: createShelfLogger({ level: "silent" }),
    config: { secret: "s" },
  });
  return await (await app.request(path)).text();
}

describe("first-run copy", () => {
  it("names the one button New project on an empty overview, and drops the pricing sentence", async () => {
    const html = await get("/projects");
    expect(html).toContain("New project");
    expect(html).not.toContain("Create project");
    expect(html).not.toContain("free and unlimited");
  });

  it("tells a signed-in user with no admin token to choose New project, above", async () => {
    const html = await getSignedInNoToken("/projects");
    expect(html).toContain("1. Choose New project, above.");
    expect(html).not.toContain("Choose Create project");
    expect(html).not.toContain("free and unlimited");
  });
});

/** The projects page for a signed-in user with the given site role and no projects. */
async function projectsPageAs(role: "member" | "viewer" | "admin"): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const user = { id: "ada", email: "ada@example.com", name: "Ada", role };
  const app = createShelfApp({
    database: db,
    storage,
    auth: stubAuth(user),
    logger: createShelfLogger({ level: "silent" }),
  });
  return await (await app.request("/projects")).text();
}

describe("projects overview for a signed-in non-admin with no projects", () => {
  it("says the user has not been added and asks an admin, with no setup steps", async () => {
    const pages = await Promise.all(
      (["member", "viewer"] as const).map(async (role) => await projectsPageAs(role)),
    );
    for (const html of pages) {
      expect(html).toContain("You have not been added to a project yet. Ask an admin.");
      expect(html).not.toContain("Create your first project");
      expect(html).not.toContain("Set up your first upload");
      expect(html).not.toContain("storyshelf create");
      expect(html).not.toContain("SHELF_ADMIN_TOKEN");
      expect(html).not.toContain("data-copy=");
    }
  });

  it("keeps the admin's own empty state and setup steps", async () => {
    const html = await projectsPageAs("admin");
    expect(html).toContain("Create your first project to start visual testing.");
    expect(html).toContain("Set up your first upload");
    expect(html).not.toContain("You have not been added to a project yet.");
  });
});
