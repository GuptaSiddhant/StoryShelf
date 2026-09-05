import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfRouter } from "../index.tsx";
import { builds } from "../schema/build.ts";
import type { Build } from "../schema/build.ts";
import { projects } from "../schema/project.ts";
import type { Project } from "../schema/project.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { storybookDir } from "../utils/paths.ts";

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

async function seededApp(): Promise<{ app: ReturnType<typeof createShelfRouter> }> {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(projects, mockProject());
  await db.insert(builds, mockBuild({ public: true }));

  objects.set(`${storybookDir("p1", "b1")}/index.html`, Buffer.from("<html>storybook</html>"));
  objects.set(`${storybookDir("p1", "b1")}/iframe.js`, Buffer.from("console.log('hi')"));
  objects.set(`${storybookDir("p1", "b1")}/styles.css`, Buffer.from("body{}"));
  objects.set(`${storybookDir("p1", "b1")}/icon.png`, Buffer.from([137, 80, 78, 71])); // PNG magic

  const app = createShelfRouter({ database: db, storage, logger: silentLogger });
  return { app };
}

describe("storybook routes", () => {
  it("resolves the default Published Storybook to the latest public build", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/projects/test-project/storybook/build/b1/");
  });

  it("returns 404 when no published build exists", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(projects, mockProject());
    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    const response = await app.request("/projects/test-project/storybook");
    expect(response.status).toBe(404);
  });

  it("returns 404 for an unknown project", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    const response = await app.request("/projects/nope/storybook");
    expect(response.status).toBe(404);
  });

  it("serves the landing page for a public build", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook/build/b1/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("iframe");
  });

  it("serves a static JS asset with the correct content type", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook/build/b1/iframe.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    expect(await response.text()).toBe("console.log('hi')");
  });

  it("serves html assets with an html content type", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook/build/b1/index.html");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("<html>storybook</html>");
  });

  it("serves css and binary assets", async () => {
    const { app } = await seededApp();
    const css = await app.request("/projects/test-project/storybook/build/b1/styles.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");

    const png = await app.request("/projects/test-project/storybook/build/b1/icon.png");
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toContain("image/png");
  });

  it("rejects path traversal", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook/build/b1/../secrets.txt");
    expect(response.status).toBe(404);
  });

  it("rejects backslash traversal segments", async () => {
    const { app } = await seededApp();
    const response = await app.request(
      "/projects/test-project/storybook/build/b1/%5C%5C..%5Csecrets.txt",
    );
    expect(response.status).toBe(404);
  });

  it("returns 404 for a missing static asset", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook/build/b1/missing.txt");
    expect(response.status).toBe(404);
  });

  it("serves a non-public build when auth is disabled", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(projects, mockProject());
    await db.insert(builds, mockBuild({ public: false }));
    objects.set(`${storybookDir("p1", "b1")}/index.html`, Buffer.from("<html>storybook</html>"));
    const app = createShelfRouter({ database: db, storage, logger: silentLogger });
    const response = await app.request("/projects/test-project/storybook/build/b1/");
    expect(response.status).toBe(200);
  });
});
