import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

/** `loadBuildDiffData` feeds the review page and the in-place swap: both show the same data. */

const T1 = "2026-01-01T00:00:00.000Z";
const PAGE = "/projects/kit/builds/b1/diff";

async function setup() {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Kit",
    slug: "kit",
    gitRepository: "owner/repo",
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    publicBranchRegex: null,
    executePlay: false,
    playTimeoutMs: 10_000,
    storybookMeta: null,
    createdAt: T1,
    updatedAt: T1,
  } as Project);
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "sha-b1",
    gitBranch: "feature/y",
    isDefault: false,
    authorEmail: null,
    authorName: null,
    message: null,
    public: false,
    status: "reviewing",
    snapshotCount: 2,
    changedCount: 2,
    approvedCount: 0,
    rejectedCount: 0,
    inheritedCount: 0,
    affectedOnly: true,
    baselineSha: null,
    changedFiles: null,
    affectedImportPaths: null,
    createdAt: T1,
    updatedAt: T1,
  } as Build);
  for (const [id, storyName] of [
    ["s1", "Primary"],
    ["s2", "Secondary"],
  ] as const) {
    objects.set(`shots/${id}.png`, Buffer.from(id));
    // oxlint-disable-next-line no-await-in-loop -- inserted in order so the list order is fixed
    await db.insert(db.tables.snapshots, {
      id,
      projectId: "p1",
      buildId: "b1",
      storyId: id,
      storyName,
      storyTitle: "Button",
      viewportName: "desktop",
      browser: "chromium",
      screenshotPath: `shots/${id}.png`,
      status: "new",
      baselineId: null,
      baselineVersion: "none",
      createdAt: T1,
      updatedAt: T1,
    });
  }
  await db.insert(db.tables.comments, {
    id: "c1",
    projectId: "p1",
    buildId: "b1",
    snapshotId: "s2",
    body: "Check the focus ring",
    kind: "comment",
    resolved: false,
    createdAt: T1,
    updatedAt: T1,
  });
  return createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    logger: pino({ level: "silent" }),
  });
}

describe("loadBuildDiffData", () => {
  it("selects the requested snapshot with its comments, on the page and in the swap", async () => {
    const app = await setup();

    const page = await (await app.request(`${PAGE}?snapshot=s2`)).text();
    const swap = await (
      await app.request("/api/v1/projects/kit/builds/b1/snapshots/s1/approve", {
        method: "POST",
        headers: { "HX-Request": "true", "HX-Current-URL": `https://shelf.test${PAGE}` },
      })
    ).text();
    for (const html of [page, swap]) {
      expect(html).toMatch(/id="snapshot-heading"[^>]*>[^<]*Secondary/u);
      expect(html).toContain("Check the focus ring");
      expect(html).toContain("data-reject");
    }
  });

  it("falls back to the first snapshot needing review without a selection", async () => {
    const app = await setup();

    const page = await (await app.request(PAGE)).text();

    expect(page).toMatch(/id="snapshot-heading"[^>]*>[^<]*Primary/u);
  });
});
