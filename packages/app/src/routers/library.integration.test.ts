import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { storybookDir } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

function mockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Test Project",
    slug: "test-project",
    gitRepository: "owner/repo",
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    publicBranchRegex: null,
    executePlay: false,
    playTimeoutMs: 10_000,
    storybookMeta: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockBuild(overrides: Partial<Build> = {}): Build {
  return {
    id: "b1",
    projectId: "p1",
    gitSha: "sha-1",
    gitBranch: "main",
    isDefault: true,
    authorEmail: null,
    authorName: null,
    message: null,
    public: false,
    status: "approved",
    snapshotCount: 0,
    changedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seededLibraryApp(index: unknown): Promise<ReturnType<typeof createShelfApp>> {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, mockProject());
  await db.insert(db.tables.builds, mockBuild());
  await db.insert(db.tables.snapshots, {
    id: "snap1",
    projectId: "p1",
    buildId: "b1",
    storyId: "components-button--primary",
    storyName: "Primary",
    storyTitle: "Components/Button",
    screenshotPath: "p1/builds/b1/screenshots/components-button--primary/desktop.png",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  if (index !== null) {
    objects.set(`${storybookDir("p1", "b1")}/index.json`, Buffer.from(JSON.stringify(index)));
  }
  return createShelfApp({ database: db, storage, logger: silentLogger });
}

const indexWithDocs = {
  v: 5,
  entries: {
    "components-button--primary": {
      id: "components-button--primary",
      title: "Components/Button",
      name: "Primary",
      type: "story",
    },
    "components-button--docs": {
      id: "components-button--docs",
      title: "Components/Button",
      name: "Docs",
      type: "docs",
    },
  },
};

const indexWithoutDocs = {
  v: 5,
  entries: {
    "components-button--primary": {
      id: "components-button--primary",
      title: "Components/Button",
      name: "Primary",
      type: "story",
    },
  },
};

describe("library routes", () => {
  it("renders a Docs link when the build index has a docs entry for the story", async () => {
    const app = await seededLibraryApp(indexWithDocs);
    const response = await app.request("/projects/test-project/library");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("storyId=components-button--docs");
    expect(body).toContain("viewMode=docs");
  });

  it("omits the Docs link when the build index has no docs entry", async () => {
    const app = await seededLibraryApp(indexWithoutDocs);
    const response = await app.request("/projects/test-project/library");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("viewMode=docs");
    expect(body).toContain("Preview");
  });

  it("omits the Docs link when the build statics are missing", async () => {
    const app = await seededLibraryApp(null);
    const response = await app.request("/projects/test-project/library");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("viewMode=docs");
    expect(body).toContain("Preview");
  });
});
