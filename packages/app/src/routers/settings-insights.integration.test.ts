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
