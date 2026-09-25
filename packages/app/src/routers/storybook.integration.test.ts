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

async function seededApp(): Promise<{ app: ReturnType<typeof createShelfApp> }> {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, mockProject());
  await db.insert(db.tables.builds, mockBuild({ public: true }));

  objects.set(`${storybookDir("p1", "b1")}/index.html`, Buffer.from("<html>storybook</html>"));
  objects.set(`${storybookDir("p1", "b1")}/iframe.html`, Buffer.from("<html>preview</html>"));
  objects.set(`${storybookDir("p1", "b1")}/iframe.js`, Buffer.from("console.log('hi')"));
  objects.set(`${storybookDir("p1", "b1")}/styles.css`, Buffer.from("body{}"));
  objects.set(`${storybookDir("p1", "b1")}/icon.png`, Buffer.from([137, 80, 78, 71])); // PNG magic

  const app = createShelfApp({ database: db, storage, logger: silentLogger });
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
    await db.insert(db.tables.projects, mockProject());
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const response = await app.request("/projects/test-project/storybook");
    expect(response.status).toBe(404);
  });

  it("returns 404 for an unknown project", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const response = await app.request("/projects/nope/storybook");
    expect(response.status).toBe(404);
  });

  it("serves the landing page for a public build", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook/build/b1/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("iframe");
  });

  it("serves a preparing state when statics are not yet extracted", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ public: true }));
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const response = await app.request("/projects/test-project/storybook/build/b1/");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Preparing preview");
    expect(body).not.toContain("<iframe");
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
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ public: false }));
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const response = await app.request("/projects/test-project/storybook/build/b1/");
    expect(response.status).toBe(200);
  });

  it("serves the landing page with docs viewMode when requested", async () => {
    const { app } = await seededApp();
    const response = await app.request(
      "/projects/test-project/storybook/build/b1/?storyId=a--b&viewMode=docs",
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("iframe.html?id=a--b");
    expect(body).toContain("viewMode=docs");
  });

  it("ignores unknown viewMode values on the landing page", async () => {
    const { app } = await seededApp();
    const response = await app.request(
      "/projects/test-project/storybook/build/b1/?storyId=a--b&viewMode=bogus",
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("iframe.html?id=a--b");
    expect(body).not.toContain("viewMode=");
  });

  it("short link renders index.html for a build ULID", async () => {
    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ id: ulid, public: true }));
    objects.set(`${storybookDir("p1", ulid)}/index.html`, Buffer.from("<html>storybook</html>"));
    objects.set(`${storybookDir("p1", ulid)}/iframe.html`, Buffer.from("<html>preview</html>"));
    objects.set(`${storybookDir("p1", ulid)}/iframe.js`, Buffer.from("console.log('hi')"));
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const response = await app.request(`/_/${ulid}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("<html>storybook</html>");
  });

  it("short link redirects without trailing slash to canonical", async () => {
    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ id: ulid, public: true }));
    objects.set(`${storybookDir("p1", ulid)}/index.html`, Buffer.from("<html>storybook</html>"));
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const response = await app.request(`/_/${ulid}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/_/${ulid}/`);
  });

  it("short link renders index.html for a project slug (latest published)", async () => {
    const { app } = await seededApp();
    const response = await app.request("/_/test-project/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>storybook</html>");
  });

  it("short link returns 404 for unknown build and slug", async () => {
    const { app } = await seededApp();
    const badUlid = "01ARZ3NDEKTSV4RRFFQ69G5FAV"; // valid 26-char ULID, not a build
    const r1 = await app.request(`/_/${badUlid}`);
    expect(r1.status).toBe(404);
    const r2 = await app.request("/_/nope");
    expect(r2.status).toBe(404);
  });

  it("short link serves static assets and rejects traversal", async () => {
    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ id: ulid, public: true }));
    objects.set(`${storybookDir("p1", ulid)}/index.html`, Buffer.from("<html>storybook</html>"));
    objects.set(`${storybookDir("p1", ulid)}/iframe.html`, Buffer.from("<html>preview</html>"));
    objects.set(`${storybookDir("p1", ulid)}/iframe.js`, Buffer.from("console.log('hi')"));
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const js = await app.request(`/_/${ulid}/iframe.js`);
    expect(js.status).toBe(200);
    const bad = await app.request(`/_/${ulid}/../secrets.txt`);
    expect(bad.status).toBe(404);
  });
});
