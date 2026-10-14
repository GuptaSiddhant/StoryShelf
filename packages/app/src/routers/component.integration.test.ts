import { PackageUsageModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const T0 = "2026-01-01T00:00:00.000Z";

async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "App",
    slug: "app",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  await db.insert(db.tables.projects, {
    id: "ds",
    name: "DS",
    slug: "ds",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  const build = (id: string, projectId: string, createdAt: string, status = "approved") =>
    db.insert(db.tables.builds, {
      id,
      projectId,
      gitSha: `sha-${id}000`,
      gitBranch: "main",
      isDefault: true,
      status,
      createdAt,
      updatedAt: createdAt,
    } as never);
  await build("b1", "p1", "2026-01-01T00:00:00.000Z");
  await build("b2", "p1", "2026-01-02T00:00:00.000Z");
  await build("db1", "ds", "2026-01-01T00:00:00.000Z");
  let n = 0;
  const snap = (
    buildId: string,
    projectId: string,
    file: string,
    storyId: string,
    title: string,
    status: string,
  ) => {
    n += 1;
    return db.insert(db.tables.snapshots, {
      id: `s${n}`,
      projectId,
      buildId,
      storyId,
      storyName: storyId.split("--")[1] ?? storyId,
      storyTitle: title,
      storyImportPath: file,
      screenshotPath: `x/${n}.png`,
      status,
      createdAt: T0,
      updatedAt: T0,
    } as never);
  };
  await snap(
    "b1",
    "p1",
    "./src/Button.stories.tsx",
    "button--primary",
    "Components/Button",
    "approved",
  );
  await snap(
    "b1",
    "p1",
    "./src/Button.stories.tsx",
    "button--secondary",
    "Components/Button",
    "approved",
  );
  await snap("b1", "p1", "./src/Old.stories.tsx", "old--default", "Components/Old", "approved");
  await snap("b1", "p1", "./src/Card.stories.tsx", "card--default", "Components/Card", "approved");
  // b2: Button retitled, Card moved, Old deleted.
  await snap("b2", "p1", "./src/Button.stories.tsx", "button--primary", "Design/Button", "changed");
  await snap(
    "b2",
    "p1",
    "./src/Button.stories.tsx",
    "button--secondary",
    "Design/Button",
    "unchanged",
  );
  await snap(
    "b2",
    "p1",
    "./src/ui/Card.stories.tsx",
    "card--default",
    "Components/Card",
    "unchanged",
  );
  await snap("db1", "ds", "./src/Tag.stories.tsx", "tag--default", "DS/Tag", "approved");
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret: "s" },
  });
  return { db, app };
}

const get = async (app: Awaited<ReturnType<typeof seed>>["app"], path: string) =>
  await app.request(path);

describe("component page", () => {
  it("shows states with story anchors, and the retitled name in place", async () => {
    const { app } = await seed();
    const res = await get(app, "/projects/app/components/src/Button.stories.tsx");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Design/Button");
    expect(html).not.toContain("Components/Button");
    expect(html).toContain('id="button--primary"');
    expect(html).toContain('id="button--secondary"');
    expect(html).toContain("src/Button.stories.tsx");
    expect(html).toContain("builds/b2/diff?snapshot=");
  });

  it("lists every build touching the file in History, each reaching its diff", async () => {
    const { app } = await seed();
    const html = await (
      await get(app, "/projects/app/components/src/Button.stories.tsx?tab=history")
    ).text();
    expect(html).toContain("builds/b1/diff?snapshot=");
    expect(html).toContain("builds/b2/diff?snapshot=");
    expect(html).toContain("1 / 2");
  });

  it("resolves a moved file via its title and a deleted file to its last build", async () => {
    const { app } = await seed();
    const moved = await (await get(app, "/projects/app/components/src/Card.stories.tsx")).text();
    expect(moved).toContain("This component moved");
    expect(moved).toContain("/projects/app/components/src/ui/Card.stories.tsx");
    const deleted = await (await get(app, "/projects/app/components/src/Old.stories.tsx")).text();
    expect(deleted).toContain("Not in the latest build");
    expect(deleted).toContain("sha-b1");
    expect(deleted).toContain("old--default");
  });

  it("404s for files never captured, unknown projects and empty paths", async () => {
    const { app } = await seed();
    expect((await get(app, "/projects/app/components/src/Nope.stories.tsx")).status).toBe(404);
    expect((await get(app, "/projects/zzz/components/src/Button.stories.tsx")).status).toBe(404);
    expect((await get(app, "/projects/app/components/")).status).toBe(404);
  });

  it("shows the Figma and Linked tabs, with empty states", async () => {
    const { app, db } = await seed();
    const figma = await (
      await get(app, "/projects/app/components/src/Button.stories.tsx?tab=figma")
    ).text();
    expect(figma).toContain("No Figma design linked");
    const none = await (
      await get(app, "/projects/app/components/src/Button.stories.tsx?tab=linked")
    ).text();
    expect(none).toContain("No linked packages");

    await new PackageUsageModel(db).replaceLinks("p1", [
      { upstreamId: "ds", packageName: "@acme/ds" },
    ]);
    await new PackageUsageModel(db).replaceForBuild("p1", "b2", [
      {
        storyImportPath: "./src/Button.stories.tsx",
        packageName: "@acme/ds",
        modulePath: "dist/Tag.js",
        version: "1.0.0",
      },
    ]);
    const linked = await (
      await get(app, "/projects/app/components/src/Button.stories.tsx?tab=linked")
    ).text();
    expect(linked).toContain("Uses @acme/ds");
    expect(linked).toContain("Story →");
    expect(linked).toContain("/projects/ds/components/src/Tag.stories.tsx");
  });

  it("links in from the library, review viewer and build cards", async () => {
    const { app } = await seed();
    const library = await (await get(app, "/projects/app/library")).text();
    expect(library).toContain('href="/projects/app/components/src/Button.stories.tsx"');
    const review = await (await get(app, "/projects/app/builds/b2/diff?snapshot=s5")).text();
    expect(review).toContain("View component");
    expect(review).toContain("/projects/app/components/src/Button.stories.tsx#button--primary");
    const card = await (await get(app, "/projects/app/builds/b2")).text();
    expect(card).toContain("/projects/app/components/src/Button.stories.tsx#button--primary");
  });
});
