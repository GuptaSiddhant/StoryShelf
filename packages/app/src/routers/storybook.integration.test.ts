import { LabelModel } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import type { Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { createUrlBuilder } from "@storyshelf/core/urls";
import { storybookDir } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

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
    inheritedCount: 0,
    affectedOnly: true,
    baselineSha: null,
    changedFiles: null,
    affectedImportPaths: null,
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

async function slugApp(builds: Partial<Build>[]) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, mockProject());
  await Promise.all(builds.map((build) => db.insert(db.tables.builds, mockBuild(build))));
  for (const build of builds) {
    const dir = storybookDir("p1", build.id ?? "b1");
    objects.set(`${dir}/index.html`, Buffer.from(`<html>${build.id}</html>`));
    objects.set(`${dir}/iframe.html`, Buffer.from("<html>preview</html>"));
  }
  const app = createShelfApp({ database: db, storage, logger: silentLogger });
  return { app };
}

describe("storybook routes", () => {
  it("resolves the project Storybook to the latest approved default-branch build", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/projects/test-project/storybook/build/b1/");
  });

  it.each(["main", "feature/login", "release/1.0#rc?x", "percent/100%"])(
    "resolves a Storybook label containing %s",
    async (value) => {
      const { db } = makeDatabase();
      const { storage } = makeStorage();
      await db.insert(db.tables.projects, mockProject());
      await db.insert(db.tables.builds, mockBuild({ public: true }));
      await new LabelModel(db).attach("p1", "b1", "branch", value);
      const app = createShelfApp({ database: db, storage, logger: silentLogger });
      const url = createUrlBuilder("").storybookLabel("test-project", "branch", value);
      const response = await app.request(url);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/projects/test-project/storybook/build/b1/");
    },
  );

  it.each(["branch/%E0%A4%A", "branch/", "branch/unknown"])(
    "rejects an invalid or unknown label path %s",
    async (labelPath) => {
      const { app } = await seededApp();
      const response = await app.request(`/projects/test-project/storybook/${labelPath}`);
      expect(response.status).toBe(404);
    },
  );

  it("answers an unauthenticated visitor to a private label as for a project that does not exist", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ public: false }));
    await new LabelModel(db).attach("p1", "b1", "branch", "feature/login");
    const app = createShelfApp({
      database: db,
      storage,
      auth: stubAuth(null),
      logger: silentLogger,
    });
    const url = createUrlBuilder("").storybookLabel("test-project", "branch", "feature/login");
    const response = await app.request(url);
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns 404 when no approved default-branch build exists", async () => {
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
    const body = await response.text();
    expect(body).toContain("iframe");
    // Landmarks: one h1 and a main around the frame.
    expect(body.match(/<h1[ >]/gu)).toHaveLength(1);
    expect(body).toMatch(/<main>[\s\S]*<iframe/u);
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

  it("lets a sandboxed preview frame load the files of a build anyone may view", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook/build/b1/iframe.js");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers CORS for every build on an instance without sign-in, public or not", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ public: false, gitBranch: "feature/x" }));
    objects.set(`${storybookDir("p1", "b1")}/iframe.js`, Buffer.from("x"));
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const response = await app.request("/projects/test-project/storybook/build/b1/iframe.js");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("withholds CORS from a private build under sign-in, where a frame has no cookies", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ public: false, gitBranch: "feature/x" }));
    objects.set(`${storybookDir("p1", "b1")}/iframe.js`, Buffer.from("x"));
    const user = { id: "u1", email: "a@example.com", name: "Ada", role: "admin" as const };
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      auth: stubAuth(user),
    });
    const response = await app.request("/projects/test-project/storybook/build/b1/iframe.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
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

  it("short link files follow the same CORS rule as the canonical route", async () => {
    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const setup = async (auth: boolean) => {
      const { db } = makeDatabase();
      const { storage, objects } = makeStorage();
      await db.insert(db.tables.projects, mockProject());
      await db.insert(
        db.tables.builds,
        mockBuild({ id: ulid, public: false, gitBranch: "feature/x" }),
      );
      objects.set(`${storybookDir("p1", ulid)}/iframe.js`, Buffer.from("x"));
      const user = { id: "u1", email: "a@example.com", name: "Ada", role: "admin" as const };
      return createShelfApp({
        database: db,
        storage,
        logger: silentLogger,
        ...(auth ? { auth: stubAuth(user) } : {}),
      });
    };
    const open = await (await setup(false)).request(`/_/${ulid}/iframe.js`);
    expect(open.status).toBe(200);
    expect(open.headers.get("access-control-allow-origin")).toBe("*");
    const signedIn = await (await setup(true)).request(`/_/${ulid}/iframe.js`);
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get("access-control-allow-origin")).toBeNull();
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

  it("short link renders index.html for a project slug (latest approved default build)", async () => {
    const { app } = await seededApp();
    const response = await app.request("/_/test-project/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>storybook</html>");
  });

  it("slug link ignores a newer approved feature-branch build", async () => {
    const { app } = await slugApp([
      { id: "main1", public: true, createdAt: "2026-01-01T00:00:00.000Z" },
      {
        id: "feat1",
        gitBranch: "feature/x",
        isDefault: false,
        public: true,
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    const response = await app.request("/_/test-project/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>main1</html>");
  });

  it("slug link skips unapproved default-branch builds", async () => {
    const { app } = await slugApp([
      { id: "ok1", public: true, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "bad1", public: true, status: "failed", createdAt: "2026-02-01T00:00:00.000Z" },
      { id: "rev1", public: true, status: "reviewing", createdAt: "2026-03-01T00:00:00.000Z" },
    ]);
    const response = await app.request("/_/test-project/");
    expect(await response.text()).toBe("<html>ok1</html>");
  });

  it("slug link returns 404 when only feature or unapproved builds exist", async () => {
    const { app } = await slugApp([
      { id: "feat1", gitBranch: "feature/x", isDefault: false, public: true },
      { id: "rev1", public: true, status: "reviewing", createdAt: "2026-03-01T00:00:00.000Z" },
    ]);
    expect((await app.request("/_/test-project/")).status).toBe(404);
  });

  it("build-id link serves a failed or unreviewed build when it is visible", async () => {
    const { app } = await slugApp([
      { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", public: true, status: "failed", gitBranch: "feature/x" },
    ]);
    const response = await app.request("/_/01ARZ3NDEKTSV4RRFFQ69G5FAV/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>01ARZ3NDEKTSV4RRFFQ69G5FAV</html>");
  });

  it("short link returns 404 for unknown build and slug", async () => {
    const { app } = await seededApp();
    const badUlid = "01ARZ3NDEKTSV4RRFFQ69G5FAV"; // valid 26-char ULID, not a build
    // The bare form always redirects (so it tells nothing about the id); the 404 is one step on.
    for (const id of [badUlid, "nope"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one request at a time keeps failures readable
      const bare = await app.request(`/_/${id}`);
      expect(bare.status, id).toBe(302);
      expect(bare.headers.get("location"), id).toBe(`/_/${id}/`);
      // oxlint-disable-next-line eslint/no-await-in-loop -- same
      expect((await app.request(`/_/${id}/`)).status, id).toBe(404);
    }
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
    // A traversal that survives URL parsing is refused by the route itself.
    const bad = await app.request(`/_/${ulid}/..%2Fsecrets.txt`);
    expect(bad.status).toBe(404);
    // One the URL parser flattens (`/_/secrets.txt`) names no project, so it ends in a 404 too.
    const flattened = await app.request(`/_/${ulid}/../secrets.txt`);
    expect(flattened.headers.get("location")).toBe("/_/secrets.txt/");
    expect((await app.request("/_/secrets.txt/")).status).toBe(404);
  });
});

describe("short links for a signed-out visitor (auth on)", () => {
  const PUBLIC_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const PRIVATE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
  const UNKNOWN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAX";

  async function signedOutApp() {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ id: PUBLIC_ID, public: true }));
    await db.insert(
      db.tables.builds,
      mockBuild({ id: PRIVATE_ID, public: false, gitBranch: "feature/x" }),
    );
    await db.insert(
      db.tables.projects,
      mockProject({ id: "p2", name: "Private", slug: "private-project" }),
    );
    await db.insert(
      db.tables.builds,
      mockBuild({ id: "private-main", projectId: "p2", public: false }),
    );
    for (const id of [PUBLIC_ID, PRIVATE_ID]) {
      objects.set(`${storybookDir("p1", id)}/index.html`, Buffer.from(`<html>${id}</html>`));
      objects.set(`${storybookDir("p1", id)}/iframe.html`, Buffer.from("<html>preview</html>"));
    }
    return createShelfApp({ database: db, storage, logger: silentLogger, auth: stubAuth(null) });
  }

  it("opens a public build's short link without signing in", async () => {
    const app = await signedOutApp();
    const response = await app.request(`/_/${PUBLIC_ID}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`<html>${PUBLIC_ID}</html>`);
  });

  it("redirects the no-slash form of a public link to the canonical one, not to login", async () => {
    const app = await signedOutApp();
    const response = await app.request(`/_/${PUBLIC_ID}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/_/${PUBLIC_ID}/`);
  });

  it("answers a private build and an unknown id with the same 404", async () => {
    const app = await signedOutApp();
    // The bare form redirects for every id; the trailing-slash route does the checks (#497).
    const bare = await Promise.all(
      [PRIVATE_ID, UNKNOWN_ID].map(async (id) => await app.request(`/_/${id}`)),
    );
    expect(bare.map((response) => [response.status, response.headers.get("location")])).toEqual([
      [302, `/_/${PRIVATE_ID}/`],
      [302, `/_/${UNKNOWN_ID}/`],
    ]);
    const paths = [PRIVATE_ID, UNKNOWN_ID].flatMap((id) => [`/_/${id}/`, `/_/${id}/iframe.js`]);
    const responses = await Promise.all(paths.map(async (path) => await app.request(path)));
    expect(
      responses.map((response) => [response.status, response.headers.get("location")]),
    ).toEqual(paths.map(() => [404, null]));
  });

  it("treats a project slug the same way: public opens, private and unknown look alike", async () => {
    const app = await signedOutApp();
    const open = await app.request("/_/test-project/");
    expect(open.status).toBe(200);
    expect((await app.request("/_/test-project")).headers.get("location")).toBe("/_/test-project/");
    const paths = ["/_/private-project/", "/_/no-such-project/"];
    const responses = await Promise.all(paths.map(async (path) => await app.request(path)));
    expect(
      responses.map((response) => [response.status, response.headers.get("location")]),
    ).toEqual(paths.map(() => [404, null]));
  });

  it("does not open the gate for other paths under /_", async () => {
    const app = await signedOutApp();
    const paths = ["/_", "/_/", "/_x/y", "/projects/test-project/builds"];
    const responses = await Promise.all(paths.map(async (path) => await app.request(path)));
    expect(
      responses.map((response) => [response.status, response.headers.get("location")]),
    ).toEqual(paths.map((path) => [302, `/auth/login?return_to=${encodeURIComponent(path)}`]));
  });
});

describe("published answers by access (#923)", () => {
  const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const viewer = { id: "u1", email: "a@example.com", name: "Ada", role: "admin" as const };

  /** One private build, reachable by its path, its ULID and its slug, with the files a page needs. */
  async function privateBuildApp(auth: ReturnType<typeof stubAuth>) {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ public: false }));
    await db.insert(
      db.tables.builds,
      mockBuild({ id: ulid, public: false, gitBranch: "feature/x" }),
    );
    for (const id of ["b1", ulid]) {
      objects.set(`${storybookDir("p1", id)}/index.html`, Buffer.from("<html>storybook</html>"));
      objects.set(`${storybookDir("p1", id)}/iframe.js`, Buffer.from("console.log('hi')"));
    }
    return createShelfApp({ database: db, storage, logger: silentLogger, auth });
  }

  it("answers a signed-in viewer's private build path as private, never shared", async () => {
    const app = await privateBuildApp(stubAuth(viewer));
    const response = await app.request("/projects/test-project/storybook/build/b1/iframe.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/u);
  });

  it("answers 304 when a viewer's cached copy still matches, with the same validators", async () => {
    const app = await privateBuildApp(stubAuth(viewer));
    const url = "/projects/test-project/storybook/build/b1/iframe.js";
    const first = await app.request(url);
    const etag = first.headers.get("etag") ?? "";
    const again = await app.request(url, { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(again.headers.get("cache-control")).toBe("private, no-cache");
    expect(again.headers.get("etag")).toBe(etag);
    const other = await app.request(url, { headers: { "if-none-match": '"stale"' } });
    expect(other.status).toBe(200);
  });

  it("keeps a public build's path publicly cacheable", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook/build/b1/iframe.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("answers a signed-in viewer's private build by its ULID short link as private", async () => {
    const app = await privateBuildApp(stubAuth(viewer));
    const response = await app.request(`/_/${ulid}/iframe.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("answers a signed-in viewer's private slug short link as private, root and files alike", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ public: false }));
    objects.set(`${storybookDir("p1", "b1")}/index.html`, Buffer.from("<html>storybook</html>"));
    objects.set(`${storybookDir("p1", "b1")}/iframe.html`, Buffer.from("<html>preview</html>"));
    objects.set(`${storybookDir("p1", "b1")}/iframe.js`, Buffer.from("console.log('hi')"));
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      auth: stubAuth(viewer),
    });
    const root = await app.request("/_/test-project/");
    expect(root.status).toBe(200);
    expect(root.headers.get("cache-control")).toBe("private, no-cache");
    const file = await app.request("/_/test-project/iframe.js");
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("answers a private landing page as private, to be revalidated", async () => {
    const app = await privateBuildApp(stubAuth(viewer));
    const response = await app.request("/projects/test-project/storybook/build/b1/");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("answers a public landing page as public, to be revalidated", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook/build/b1/");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, no-cache");
  });
});

describe("published answers by access (#923)", () => {
  const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const viewer = { id: "u1", email: "a@example.com", name: "Ada", role: "admin" as const };

  /** One private build, reachable by its path, its ULID and its slug, with the files a page needs. */
  async function privateBuildApp(auth: ReturnType<typeof stubAuth>) {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ public: false }));
    await db.insert(
      db.tables.builds,
      mockBuild({ id: ulid, public: false, gitBranch: "feature/x" }),
    );
    for (const id of ["b1", ulid]) {
      objects.set(`${storybookDir("p1", id)}/index.html`, Buffer.from("<html>storybook</html>"));
      objects.set(`${storybookDir("p1", id)}/iframe.js`, Buffer.from("console.log('hi')"));
    }
    return createShelfApp({ database: db, storage, logger: silentLogger, auth });
  }

  it("answers a signed-in viewer's private build path as private, never shared", async () => {
    const app = await privateBuildApp(stubAuth(viewer));
    const response = await app.request("/projects/test-project/storybook/build/b1/iframe.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/u);
  });

  it("answers 304 when a viewer's cached copy still matches, with the same validators", async () => {
    const app = await privateBuildApp(stubAuth(viewer));
    const url = "/projects/test-project/storybook/build/b1/iframe.js";
    const first = await app.request(url);
    const etag = first.headers.get("etag") ?? "";
    const again = await app.request(url, { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(again.headers.get("cache-control")).toBe("private, no-cache");
    expect(again.headers.get("etag")).toBe(etag);
    const other = await app.request(url, { headers: { "if-none-match": '"stale"' } });
    expect(other.status).toBe(200);
  });

  it("keeps a public build's path publicly cacheable", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook/build/b1/iframe.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("answers a signed-in viewer's private build by its ULID short link as private", async () => {
    const app = await privateBuildApp(stubAuth(viewer));
    const response = await app.request(`/_/${ulid}/iframe.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("answers a signed-in viewer's private slug short link as private, root and files alike", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, mockProject());
    await db.insert(db.tables.builds, mockBuild({ public: false }));
    objects.set(`${storybookDir("p1", "b1")}/index.html`, Buffer.from("<html>storybook</html>"));
    objects.set(`${storybookDir("p1", "b1")}/iframe.html`, Buffer.from("<html>preview</html>"));
    objects.set(`${storybookDir("p1", "b1")}/iframe.js`, Buffer.from("console.log('hi')"));
    const app = createShelfApp({
      database: db,
      storage,
      logger: silentLogger,
      auth: stubAuth(viewer),
    });
    const root = await app.request("/_/test-project/");
    expect(root.status).toBe(200);
    expect(root.headers.get("cache-control")).toBe("private, no-cache");
    const file = await app.request("/_/test-project/iframe.js");
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("answers a private landing page as private, to be revalidated", async () => {
    const app = await privateBuildApp(stubAuth(viewer));
    const response = await app.request("/projects/test-project/storybook/build/b1/");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("answers a public landing page as public, to be revalidated", async () => {
    const { app } = await seededApp();
    const response = await app.request("/projects/test-project/storybook/build/b1/");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, no-cache");
  });
});
