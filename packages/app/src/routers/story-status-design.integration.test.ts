import { DesignCredentialModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { createFigmaDesign } from "@storyshelf/design-figma";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

/** The design half of the addon's endpoint (ADR 0042, decision 3): only a known problem is reported. */

const SECRET = "story-status-design-secret";
const NOW = "2026-01-01T00:00:00.000Z";
const figma = createFigmaDesign();

/** One story per file; the URL is the design its stories declare. */
const FILES = [
  { name: "Button", url: "https://www.figma.com/design/KEY/Kit?node-id=1-2" },
  { name: "Tag", url: "https://www.figma.com/design/TAG/Kit" },
  { name: "Input", url: "https://www.figma.com/design/INP/Kit?node-id=3-4" },
  { name: "Card", url: null },
  { name: "Menu", url: "https://www.figma.com/design/NEW/Kit?node-id=7-8" },
];

const storyId = (name: string): string => `${name.toLowerCase()}--default`;

async function seed(options: { token: boolean }) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "App",
    slug: "app",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "abc1234",
    gitBranch: "main",
    isDefault: true,
    status: "approved",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  for (const file of FILES) {
    await db.insert(db.tables.snapshots, {
      id: `snap-${file.name}`,
      projectId: "p1",
      buildId: "b1",
      storyId: storyId(file.name),
      storyName: "Default",
      storyTitle: `Kit/${file.name}`,
      storyImportPath: `./src/${file.name}.stories.tsx`,
      screenshotPath: `p1/${file.name}.png`,
      status: "unchanged",
      designUrl: file.url,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    await db.insert(db.tables.baselines, {
      id: `base-${file.name}`,
      projectId: "p1",
      storyId: storyId(file.name),
      viewportName: "default",
      branch: "main",
      browser: "chromium",
      screenshotPath: `p1/${file.name}.png`,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
  }
  const node = async (id: string, fileKey: string, nodeId: string, extra: object) =>
    await db.insert(db.tables.designNodes, {
      id,
      projectId: "p1",
      provider: "figma",
      viewerId: "",
      fileKey,
      nodeId,
      name: id,
      version: "1",
      lastModified: "2025-12-01T00:00:00.000Z",
      state: "ok",
      renderPath: null,
      renderVersion: null,
      fetchedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      ...extra,
    } as never);
  // Changed after the baseline was approved; gone; unchanged since. Menu's design was never fetched.
  await node("Button node", "KEY", "1:2", { lastModified: "2026-02-01T00:00:00.000Z" });
  await node("Tag file", "TAG", "", { state: "deleted", lastModified: null });
  await node("Input node", "INP", "3:4", {});
  if (options.token) await new DesignCredentialModel(db, SECRET).set("p1", "figma", "figd_token");
  return createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret: SECRET },
    design: [figma],
  });
}

async function statuses(app: Awaited<ReturnType<typeof seed>>): Promise<Record<string, unknown>> {
  const response = await app.request("/api/v1/projects/app/builds/b1/story-status");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { stories: Record<string, unknown> };
  return body.stories;
}

describe("story-status design drift", () => {
  it("reports a design that changed after approval as stale and a removed one as deleted", async () => {
    const stories = await statuses(await seed({ token: true }));
    expect(stories[storyId("Button")]).toEqual({ status: "unchanged", design: "stale" });
    expect(stories[storyId("Tag")]).toEqual({ status: "unchanged", design: "deleted" });
  });

  it("leaves out a current, an unlinked and a never-fetched design", async () => {
    const stories = await statuses(await seed({ token: true }));
    for (const name of ["Input", "Card", "Menu"]) {
      expect(stories[storyId(name)]).toEqual({ status: "unchanged" });
    }
  });

  it("reports no design problem without a project token, since nothing says it changed", async () => {
    const stories = await statuses(await seed({ token: false }));
    expect(Object.values(stories).every((entry) => !("design" in (entry as object)))).toBe(true);
  });
});
