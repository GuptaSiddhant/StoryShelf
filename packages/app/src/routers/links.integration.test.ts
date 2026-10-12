import { PackageUsageModel } from "@storyshelf/core/models";
import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });
const NOW = "2026-01-01T00:00:00.000Z";

const makeProject = (id: string, slug: string): Project => ({
  id,
  name: slug,
  slug,
  gitRepository: null,
  gitDefaultBranch: "main",
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  publicBranchRegex: null,
  executePlay: false,
  playTimeoutMs: 10_000,
  storybookMeta: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const makeBuild = (id: string, projectId: string): Build => ({
  id,
  projectId,
  gitSha: `sha-${id}`,
  gitBranch: "main",
  isDefault: true,
  authorEmail: null,
  authorName: null,
  message: null,
  public: false,
  status: "approved",
  snapshotCount: 1,
  affectedOnly: true,
  baselineSha: null,
  changedFiles: null,
  affectedImportPaths: null,
  changedCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
});

const makeSnapshot = (
  id: string,
  projectId: string,
  buildId: string,
  storyId: string,
  storyImportPath: string,
): Snapshot => ({
  id,
  projectId,
  buildId,
  storyId,
  storyName: "Primary",
  storyTitle: "Story",
  storyImportPath,
  viewportName: "desktop",
  viewportWidth: 1280,
  viewportHeight: 720,
  screenshotPath: "x.png",
  diffPath: null,
  diffPixels: null,
  diffRatio: null,
  diffPassed: null,
  status: "unchanged",
  reviewedBy: null,
  reviewedAt: null,
  infraHash: null,
  inherited: false,
  baselineId: null,
  baselineVersion: null,
  createdAt: NOW,
  updatedAt: NOW,
});

async function setup() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, makeProject("app", "app"));
  await db.insert(db.tables.projects, makeProject("ds", "design-system"));
  await db.insert(db.tables.builds, makeBuild("app-b1", "app"));
  await db.insert(db.tables.builds, makeBuild("ds-b1", "ds"));
  await db.insert(
    db.tables.snapshots,
    makeSnapshot("app-s1", "app", "app-b1", "card--default", "src/Card.stories.tsx"),
  );
  await db.insert(
    db.tables.snapshots,
    makeSnapshot("ds-s1", "ds", "ds-b1", "button--primary", "src/Button.stories.tsx"),
  );
  const app = createShelfApp({ database: db, storage, logger: silentLogger });
  return { db, app };
}

const json = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("project links API", () => {
  it("replaces and lists links", async () => {
    const { app } = await setup();
    const put = await app.request(
      "/api/v1/projects/app/links",
      json({ links: [{ package: "@acme/ds", upstreamSlug: "design-system" }] }),
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      links: [{ package: "@acme/ds", upstreamSlug: "design-system" }],
    });
    const list = await app.request("/api/v1/projects/app/links");
    expect(await list.json()).toEqual({
      links: [{ package: "@acme/ds", upstreamSlug: "design-system" }],
    });
    const cleared = await app.request("/api/v1/projects/app/links", json({ links: [] }));
    expect(await cleared.json()).toEqual({ links: [] });
  });

  it.each([
    ["an unknown upstream", [{ package: "x", upstreamSlug: "nope" }]],
    ["a self link", [{ package: "x", upstreamSlug: "app" }]],
    [
      "a duplicate package",
      [
        { package: "x", upstreamSlug: "design-system" },
        { package: "x", upstreamSlug: "design-system" },
      ],
    ],
  ])("rejects %s", async (_label, links) => {
    const { app } = await setup();
    const response = await app.request("/api/v1/projects/app/links", json({ links }));
    expect(response.status).toBe(400);
  });
});

async function withUsage() {
  const ctx = await setup();
  await new PackageUsageModel(ctx.db).replaceForBuild("app", "app-b1", [
    {
      storyImportPath: "src/Card.stories.tsx",
      packageName: "@acme/ds",
      modulePath: "node_modules/@acme/ds/dist/Button.js",
      version: "2.4.0",
    },
    {
      storyImportPath: "src/Card.stories.tsx",
      packageName: "react",
      modulePath: "node_modules/react/index.js",
      version: "18.3.1",
    },
  ]);
  return ctx;
}

describe("snapshot usage API", () => {
  const usagePath = "/api/v1/projects/app/builds/app-b1/snapshots/app-s1/usage";

  it("returns only linked packages with the matched upstream story", async () => {
    const { app } = await withUsage();
    await app.request(
      "/api/v1/projects/app/links",
      json({ links: [{ package: "@acme/ds", upstreamSlug: "design-system" }] }),
    );
    const response = await app.request(usagePath);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        package: "@acme/ds",
        version: "2.4.0",
        upstreamSlug: "design-system",
        upstreamBuildId: "ds-b1",
        upstreamStoryId: "button--primary",
      },
    ]);
  });

  it("shows the badge with Preview and History links on the review page", async () => {
    const { app } = await withUsage();
    await app.request(
      "/api/v1/projects/app/links",
      json({ links: [{ package: "@acme/ds", upstreamSlug: "design-system" }] }),
    );
    const html = await (await app.request("/projects/app/builds/app-b1/diff")).text();
    expect(html).toContain("Uses @acme/ds v2.4.0");
    expect(html).toContain("/projects/design-system/storybook/build/ds-b1?storyId=button--primary");
    expect(html).toContain("/projects/design-system/library");
    expect(html).not.toContain("Uses react");
  });

  it("renders no badge on the review page without links", async () => {
    const { app } = await withUsage();
    const html = await (await app.request("/projects/app/builds/app-b1/diff")).text();
    expect(html).not.toContain("Uses @acme/ds");
    expect(html).toContain("Story");
  });

  it("falls back to a null story when the module has no upstream match", async () => {
    const { app, db } = await withUsage();
    await new PackageUsageModel(db).replaceLinks("app", [
      { upstreamId: "ds", packageName: "@acme/ds" },
    ]);
    await new PackageUsageModel(db).replaceForBuild("app", "app-b1", [
      {
        storyImportPath: "src/Card.stories.tsx",
        packageName: "@acme/ds",
        modulePath: "node_modules/@acme/ds/dist/Unknown.js",
        version: null,
      },
    ]);
    const body = (await (await app.request(usagePath)).json()) as { upstreamStoryId: unknown }[];
    expect(body[0]?.upstreamStoryId).toBeNull();
  });

  it("is empty without links, and 404s for an unknown snapshot", async () => {
    const { app } = await withUsage();
    expect(await (await app.request(usagePath)).json()).toEqual([]);
    const missing = await app.request("/api/v1/projects/app/builds/app-b1/snapshots/nope/usage");
    expect(missing.status).toBe(404);
  });
});
