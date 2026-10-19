import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel, SnapshotModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

interface Seeded {
  html: string;
  firstId: string;
}

type Db = ReturnType<typeof makeDatabase>["db"];

const SPECS = [
  ["Primary", "changed"],
  ["Secondary", "unchanged"],
  ["Ghost", "new"],
] as const;

/** Create the snapshots, returning ids in the order the review page lists them. */
async function seedSnapshots(db: Db, projectId: string, buildId: string): Promise<string[]> {
  const snapshots = new SnapshotModel(db);
  await Promise.all(
    SPECS.map(async ([name, status]) => {
      const snap = await snapshots.create(projectId, buildId, {
        storyId: `button--${name}`,
        storyName: name,
        storyTitle: "Button",
        viewportName: "desktop",
        viewportWidth: 1280,
        viewportHeight: 720,
        screenshotPath: `shots/${name}.png`,
      });
      await snapshots.update(snap.id, { status });
    }),
  );
  return (await snapshots.listByBuild(buildId)).map((snap) => snap.id);
}

async function reviewPage(select: "first" | "none" = "none"): Promise<Seeded> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db).create({ name: "Docs" });
  const build = await new BuildModel(db).create(project.id, {
    gitSha: "abc1234def",
    gitBranch: "feature/x",
    authorName: "Ada Lovelace",
  });
  const ids = await seedSnapshots(db, project.id, build.id);
  const app = createShelfApp({
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  const query = select === "first" ? `?snapshot=${ids[0]}` : "";
  const url = `/projects/${project.slug}/builds/${build.id}/diff${query}`;
  return { html: await (await app.request(url)).text(), firstId: ids[0] ?? "" };
}

describe("review workspace page", () => {
  it("renders header, filmstrip, comparison stage, and action bar", async () => {
    const { html } = await reviewPage();
    expect(html).toContain("feature/x");
    expect(html).toContain("0 of 2 reviewed");
    expect(html).toContain('aria-label="Snapshots"');
    expect(html).toContain("data-compare");
    expect(html).toContain('role="toolbar"');
    expect(html).toContain("<dialog");
  });

  it("filters the filmstrip to items needing review by default", async () => {
    const { html } = await reviewPage();
    expect(html).toContain('data-filter="review"');
    expect(html).toContain("Needs review 2");
    expect(html).toContain("All 3");
  });

  it("selects the first open snapshot and offers approve/reject with toasts", async () => {
    const { html } = await reviewPage();
    expect(html).toContain("data-approve");
    expect(html).toContain("data-reject");
    expect(html).toMatch(/data-toast="Approved (?:Primary|Ghost)"/u);
    expect(html).toMatch(/data-toast="Rejected (?:Primary|Ghost)"/u);
    expect(html).toContain('data-toast-tone="warning"');
  });

  it("asks for confirmation before bulk actions", async () => {
    const { html } = await reviewPage();
    expect(html).toContain('hx-confirm="Approve all 2 remaining changes?"');
    expect(html).toContain('hx-confirm="Reject all 2 remaining changes?"');
  });

  it("links neighbours and disables previous on the first snapshot", async () => {
    const { html, firstId } = await reviewPage("first");
    expect(html).toContain('data-snap-next="true"');
    expect(html).not.toContain('data-snap-prev="true"');
    expect(html).toContain(`aria-current="true"`);
    expect(html).toContain(`data-snapshot-id="${firstId}"`);
    expect(html).toMatch(/\b1 \/ 3\b/u);
  });

  it("uses the wide layout so the workspace is not capped at the reading width", async () => {
    const { html } = await reviewPage();
    expect(html).toContain("ss-shell-content-wide-");
  });
});

describe("review page breadcrumb", () => {
  it("lists Builds and the build (ancestors), not Review itself", async () => {
    const { html } = await reviewPage();
    const topbar = html.slice(html.indexOf('role="banner"'), html.indexOf("</header>"));
    expect(topbar).toContain(">Builds</a>");
    expect(topbar).toContain("feature/x · abc1234");
    expect(topbar).not.toContain(">Review<");
  });

  it("has no duplicate back-to-builds link in the header (the breadcrumb is the way back)", async () => {
    const { html } = await reviewPage();
    const header = html.slice(
      html.indexOf("<main"),
      html.indexOf("</header>", html.indexOf("<main")),
    );
    expect(header).not.toContain(">Builds<");
  });
});

const MULTI_BROWSER_SPECS = [
  ["chromium", "button--dark", "chromium"],
  ["firefox", "button--dark", "firefox"],
  ["other", "button--light", "chromium"],
] as const;

/** Seed one story in two modes, the first on two engines; returns ids by spec key. */
async function seedMultiBrowser(
  db: Db,
  projectId: string,
  buildId: string,
): Promise<Record<string, string>> {
  const snapshots = new SnapshotModel(db);
  const entries = await Promise.all(
    MULTI_BROWSER_SPECS.map(async ([key, storyId, browser]) => {
      const snap = await snapshots.create(projectId, buildId, {
        storyId,
        storyName: storyId,
        storyTitle: "Button",
        viewportName: storyId.endsWith("dark") ? "dark" : "light",
        viewportWidth: 1280,
        viewportHeight: 720,
        screenshotPath: `shots/${key}.png`,
        browser,
      });
      await snapshots.update(snap.id, { status: "changed" });
      return [key, snap.id] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function multiBrowserPage(query: (ids: Record<string, string>) => string): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db).create({ name: "Docs" });
  const build = await new BuildModel(db).create(project.id, {
    gitSha: "abc1234def",
    gitBranch: "feature/x",
  });
  const ids = await seedMultiBrowser(db, project.id, build.id);
  const app = createShelfApp({
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  const url = `/projects/${project.slug}/builds/${build.id}/diff${query(ids)}`;
  return await (await app.request(url)).text();
}

describe("review page with several browsers", () => {
  it("counts one review item per story/mode and offers a shared approval", async () => {
    const html = await multiBrowserPage((ids) => `?snapshot=${ids["chromium"]}`);
    expect(html).toContain("0 of 2 reviewed");
    expect(html).toContain("Needs review 2");
    expect(html).toContain("All 2");
    expect(html).toContain("2 browsers");
    expect(html).toContain("Approve all browsers");
    expect(html).toContain("/stories/button--dark/modes/dark/approve");
    expect(html).toContain("/stories/button--dark/modes/dark/reject");
    expect(html).toMatch(/\b1 \/ 2\b/u);
  });

  it("shows browser tabs and a per-browser escape hatch", async () => {
    const html = await multiBrowserPage((ids) => `?snapshot=${ids["firefox"]}`);
    expect(html).toContain('data-browser-tabs="true"');
    expect(html).toContain("chromium · changed");
    expect(html).toContain("firefox · changed");
    expect(html).toContain("Only firefox");
  });

  it("keeps the single-browser flow unchanged for a lone snapshot", async () => {
    const html = await multiBrowserPage((ids) => `?snapshot=${ids["other"]}`);
    expect(html).not.toContain('data-browser-tabs="true"');
    expect(html).not.toContain("Approve all browsers");
    expect(html).toMatch(/\/snapshots\/[A-Z0-9]+\/approve/u);
  });
});

const change = JSON.stringify({
  changed: ["browserVersion"],
  from: { engine: "chromium", browserVersion: "124.0.1" },
  to: { engine: "chromium", browserVersion: "126.0.0" },
});

async function seedMigrated(db: Db, migrated: boolean): Promise<string> {
  const project = await new ProjectModel(db).create({ name: "Env" });
  const build = await new BuildModel(db).create(project.id, {
    gitSha: "abc1234def",
    gitBranch: "main",
  });
  const snapshots = new SnapshotModel(db);
  const snap = await snapshots.create(project.id, build.id, {
    storyId: "button--Primary",
    storyName: "Primary",
    storyTitle: "Button",
    viewportName: "desktop",
    viewportWidth: 1280,
    viewportHeight: 720,
    screenshotPath: "shots/Primary.png",
    ...(migrated ? { envChange: change } : {}),
  });
  await snapshots.update(snap.id, { status: "unchanged" });
  return `/projects/${project.slug}/builds/${build.id}/diff?snapshot=${snap.id}`;
}

async function pageWithMigration(migrated: boolean): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const url = await seedMigrated(db, migrated);
  const app = createShelfApp({
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  await app.lifecycle.setup();
  return await (await app.request(url)).text();
}

describe("review page: capture environment migration", () => {
  it("explains that migrated snapshots were accepted without a diff", async () => {
    const html = await pageWithMigration(true);
    expect(html).toContain("Capture environment changed");
    expect(html).toContain("accepted without a pixel diff");
    expect(html).toContain("browser version");
    expect(html).toContain("124.0.1 → 126.0.0");
    expect(html).toContain("No diff: capture environment changed");
  });

  it("shows nothing about the environment for an ordinary build", async () => {
    const html = await pageWithMigration(false);
    expect(html).not.toContain("Capture environment changed");
    expect(html).not.toContain("No diff:");
  });
});
