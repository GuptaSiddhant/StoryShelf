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

  it("shows Builds / build / Review in the breadcrumb", async () => {
    const { html } = await reviewPage();
    const topbar = html.slice(html.indexOf('role="banner"'), html.indexOf("</header>"));
    expect(topbar).toContain(">Builds</a>");
    expect(topbar).toContain("feature/x · abc1234");
    expect(topbar).toContain('aria-current="page">Review<');
  });
});
