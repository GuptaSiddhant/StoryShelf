import type { BuildReferenceLifecycle, ContentUsage } from "@storyshelf/core/adapter/database";
import { createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

/** Two projects whose builds sit in the one shared capture queue. */
async function bootTwoProjects() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const docs = await createTestProject(db, db.tables, { name: "Docs" });
  const shop = await createTestProject(db, db.tables, { name: "Shop" });
  const docsBuild = await createTestBuild(db, db.tables, docs.id);
  const shopBuild = await createTestBuild(db, db.tables, shop.id);
  const queue = createDatabaseCaptureQueue(db);
  await queue.enqueue({ buildId: docsBuild.id });
  await queue.enqueue({ buildId: shopBuild.id });
  const app = createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  return { app, docsBuild, shopBuild };
}

describe("Insights queue isolation between projects", () => {
  it("lists only the project's own queued builds on the Insights tab", async () => {
    const { app, docsBuild, shopBuild } = await bootTwoProjects();
    const html = await (await app.request("/projects/docs/settings/insights")).text();
    expect(html).toContain(docsBuild.id);
    expect(html).not.toContain(shopBuild.id);
  });

  it("lists only the project's own queued builds in the refreshed queue fragment", async () => {
    const { app, docsBuild, shopBuild } = await bootTwoProjects();
    const html = await (await app.request("/projects/shop/jobs?partial=queue")).text();
    expect(html).toContain(shopBuild.id);
    expect(html).not.toContain(docsBuild.id);
  });

  it("answers 404 for a project that does not exist, on both views", async () => {
    const { app } = await bootTwoProjects();
    expect((await app.request("/projects/ghost/settings/insights")).status).toBe(404);
    expect((await app.request("/projects/ghost/jobs?partial=queue")).status).toBe(404);
  });
});

/** A lifecycle that does nothing but report the given content usage. */
function lifecycleReporting(usage: ContentUsage): BuildReferenceLifecycle {
  return {
    referenceGeneration: async () => await Promise.resolve(0),
    replaceManyFencedReferences: async () => await Promise.resolve({ result: [], generations: [] }),
    replaceFencedReferences: async () => await Promise.resolve({ result: [], generation: 1 }),
    claimDeletion: async () => "missing",
    listDeleting: async () => [],
    releaseBuildContent: async () => "not-deleting",
    markStorageDeleted: async () => "not-deleting",
    completeDeletion: async () => "not-deleting",
    recordContentUses: async () => [],
    contentUsage: async () => await Promise.resolve(usage),
    claimContent: async () => [],
    holdsContentClaim: async () => false,
    abandonContentClaim: async () => {},
    finishContentCollection: async () => {},
  } as unknown as BuildReferenceLifecycle;
}

/** The Insights tab of a project whose database reports the given content usage (null: it cannot). */
async function insightsHtml(
  usage: { bytes: number; blobs: number; unsized: number } | null,
): Promise<string> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await createTestProject(db, db.tables, { name: "Docs" });
  const app = createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    logger: createShelfLogger({ level: "silent" }),
  });
  // Attached after boot: the app only reads it per request, and boot would otherwise prepare baselines through it.
  if (usage) {
    Object.assign(db, { buildReferenceLifecycle: lifecycleReporting(usage) });
  }
  return await (await app.request("/projects/docs/settings/insights")).text();
}

describe("Insights storage card", () => {
  it("shows the summed size, the file count and how many files have no recorded size", async () => {
    const html = await insightsHtml({ bytes: 1_240_000_000, blobs: 18_450, unsized: 340 });
    expect(html).toContain("Storage used");
    expect(html).toContain("1.2 GB");
    expect(html).toContain("18790");
    expect(html).toContain("340 files uploaded before sizes were recorded");
  });

  it("names nothing as missing when every file has a size, and says so for an empty project", async () => {
    const sized = await insightsHtml({ bytes: 4_820_000, blobs: 63, unsized: 0 });
    expect(sized).toContain("4.8 MB");
    expect(sized).not.toContain("before sizes were recorded");
    const empty = await insightsHtml({ bytes: 0, blobs: 0, unsized: 0 });
    expect(empty).toContain("Nothing is published yet.");
  });

  it("leaves the card out when the database cannot report usage", async () => {
    expect(await insightsHtml(null)).not.toContain("Storage used");
  });
});
