/* oxlint-disable eslint/no-await-in-loop -- one request at a time keeps failures readable */
import { BuildModel, CommentModel, SnapshotModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { API_ROUTE_CLASSES } from "../routes/api-routes.ts";
import { PAGE_ROUTE_CLASSES } from "../routes/page-routes.ts";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

/**
 * Anonymous read-only pages of public builds (#1172, ADR 0011): a visitor who is not signed in
 * reads a public build's list entry, review page and images; a private build answers exactly like
 * a missing one, and nothing a visitor sends writes anything.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const PRIVATE_BRANCH = "secret/launch-plan";
const PRIVATE_MESSAGE = "SECRET-COMMIT-MESSAGE";
const PRIVATE_AUTHOR = "Private Author";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
/** A well-formed build id that no build has. */
const UNKNOWN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const member = { id: "dev", email: "dev@example.com", name: "Dev", role: "member" as const };
const auth = stubAuth(null, {
  check: async (request: Request) =>
    await Promise.resolve(
      (request.headers.get("cookie") ?? "").includes("storyshelf_session=dev") ? member : null,
    ),
});

interface Seeded {
  app: ReturnType<typeof createShelfApp>;
  db: ReturnType<typeof makeDatabase>["db"];
  publicId: string;
  privateId: string;
  publicSnapshot: string;
  privateSnapshot: string;
  hiddenId: string;
}

let scratchDir = "";
let booted: Seeded | undefined;
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-anonymous-"));
});
afterEach(async () => {
  try {
    await booted?.app.lifecycle.teardown();
  } finally {
    booted = undefined;
    await rm(scratchDir, { recursive: true, force: true });
  }
});

async function project(
  db: Seeded["db"],
  id: string,
  slug: string,
  publicBranchRegex: string | null,
): Promise<void> {
  await db.insert(db.tables.projects, {
    id,
    name: slug === "demo" ? "Demo" : "Hidden",
    slug,
    gitRepository: `acme/${slug}`,
    gitDefaultBranch: "main",
    publicBranchRegex,
    reviewEnabled: true,
    reviewApprovals: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

/** A reviewing build with one changed snapshot whose screenshot and diff are stored. */
async function buildWithSnapshot(
  db: Seeded["db"],
  storage: ReturnType<typeof makeStorage>["storage"],
  projectId: string,
  branch: string,
): Promise<{ buildId: string; snapshotId: string }> {
  const builds = new BuildModel(db);
  const build = await builds.create(projectId, {
    gitSha: branch === "main" ? "a".repeat(40) : "b".repeat(40),
    gitBranch: branch,
    message: branch === "main" ? "Public change" : PRIVATE_MESSAGE,
    authorName: branch === "main" ? "Public Author" : PRIVATE_AUTHOR,
  });
  await storage.write(`${build.id}/shot.png`, PNG);
  await storage.write(`${build.id}/diff.png`, PNG);
  const snapshot = await new SnapshotModel(db).create(projectId, build.id, {
    storyId: `story-${branch.replaceAll("/", "-")}`,
    storyName: "Primary",
    storyTitle: "Button",
    viewportName: "desktop",
    viewportWidth: 1280,
    viewportHeight: 720,
    screenshotPath: `${build.id}/shot.png`,
    diffPath: `${build.id}/diff.png`,
    status: "changed",
  });
  await builds.update(build.id, { status: "reviewing" });
  await builds.updateCounts(build.id);
  return { buildId: build.id, snapshotId: snapshot.id };
}

async function boot(): Promise<Seeded> {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await project(db, "p1", "demo", "^main$");
  await project(db, "p2", "hidden", null);
  await db.insert(db.tables.users, {
    ...member,
    avatarUrl: null,
    lastLoginAt: null,
    createdAt: NOW,
  });
  const open = await buildWithSnapshot(db, storage, "p1", "main");
  const closed = await buildWithSnapshot(db, storage, "p1", PRIVATE_BRANCH);
  const hidden = await buildWithSnapshot(db, storage, "p2", "main");
  const app = createShelfApp({
    database: db,
    storage,
    auth,
    testing: { runner: stubRunner() },
    config: { secret: "s", scratchDir, publicBaseUrl: "https://shelf.example" },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  booted = {
    app,
    db,
    publicId: open.buildId,
    publicSnapshot: open.snapshotId,
    privateId: closed.buildId,
    privateSnapshot: closed.snapshotId,
    hiddenId: hidden.buildId,
  };
  return booted;
}

let requests = 0;

/** An image of a snapshot in the public project. */
function mediaPath(buildId: string, snapshotId: string, kind: string): string {
  return `/api/v1/projects/demo/builds/${buildId}/snapshots/${snapshotId}/${kind}`;
}

/** A browser navigation (or image fetch) with no session. */
async function anonymous(
  seeded: Seeded,
  path: string,
  init: { method?: string; accept?: string } = {},
): Promise<Response> {
  requests += 1;
  return await seeded.app.request(path, {
    method: init.method ?? "GET",
    headers: {
      accept: init.accept ?? "text/html",
      // A fresh client address per request keeps the rate limiter from answering for the routes.
      "x-forwarded-for": `10.2.${Math.floor(requests / 250)}.${requests % 250}`,
    },
  });
}

/** What a visitor can observe of an answer, with the ids it was asked about made equal. */
async function observed(seeded: Seeded, response: Response): Promise<Record<string, unknown>> {
  const ids = [seeded.privateId, seeded.privateSnapshot, seeded.hiddenId, UNKNOWN_ID];
  const scrub = (text: string): string => {
    let out = text;
    for (const id of ids) {
      out = out.replaceAll(id, ":id");
    }
    return out
      .replaceAll(/hidden|ghost/gu, ":slug")
      .replaceAll(/name="csrf-token" content="[^"]*"/gu, 'name="csrf-token" content=":token"');
  };
  return {
    status: response.status,
    body: scrub(await response.text()),
    cacheControl: response.headers.get("cache-control"),
    contentType: response.headers.get("content-type"),
    location: scrub(response.headers.get("location") ?? ""),
  };
}

describe("anonymous pages of a public build", () => {
  it("lists only the public builds of the project, with no private branch, message or id", async () => {
    const seeded = await boot();
    const response = await anonymous(seeded, "/projects/demo/builds");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    const html = await response.text();
    expect(html).toContain(`/projects/demo/builds/${seeded.publicId}`);
    for (const secret of [
      PRIVATE_BRANCH,
      PRIVATE_MESSAGE,
      PRIVATE_AUTHOR,
      seeded.privateId,
      "Hidden",
    ]) {
      expect(html, secret).not.toContain(secret);
    }
    // The status counts are of public builds only (one reviewing build).
    expect(html).toContain("All 1");
  });

  it("keeps a branch filter naming a private branch empty", async () => {
    const seeded = await boot();
    const html = await (
      await anonymous(seeded, `/projects/demo/builds?branch=${encodeURIComponent(PRIVATE_BRANCH)}`)
    ).text();
    expect(html).not.toContain(PRIVATE_MESSAGE);
    expect(html).not.toContain(seeded.privateId);
  });

  it("lands a visitor on the builds list from the project's own address", async () => {
    const seeded = await boot();
    const response = await anonymous(seeded, "/projects/demo");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/projects/demo/builds");
  });

  it("renders the review page of a public build, read-only and private to the browser", async () => {
    const seeded = await boot();
    const redirect = await anonymous(seeded, `/projects/demo/builds/${seeded.publicId}`);
    expect(redirect.status).toBe(302);
    const response = await anonymous(seeded, `/projects/demo/builds/${seeded.publicId}/diff`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    const html = await response.text();
    expect(html).toContain("Primary");
    // Read-only by construction: no write form or request of any kind renders.
    expect(html).not.toMatch(/method="post"/iu);
    expect(html).not.toMatch(/hx-(?:post|put|patch|delete)=/u);
    // Every request the page makes on its own is one a visitor may make.
    for (const match of html.matchAll(/hx-get="(?<url>[^"]*)"/gu)) {
      expect(match.groups?.["url"]).toMatch(/^\/projects\/demo\/builds(?:[/?]|$)/u);
    }
    for (const secret of [
      PRIVATE_BRANCH,
      PRIVATE_MESSAGE,
      PRIVATE_AUTHOR,
      seeded.privateId,
      "Hidden",
      "/settings",
      "New project",
      "/profile",
    ]) {
      expect(html, secret).not.toContain(secret);
    }
    // The chrome offers only a way to sign in.
    expect(html).toContain("/auth/login");
  });

  it("links, posts and fetches nothing but what a visitor may read", async () => {
    const seeded = await boot();
    const html = await (
      await anonymous(seeded, `/projects/demo/builds/${seeded.publicId}/diff`)
    ).text();
    // Every address the page names (links, forms, requests, images), with ids made stable.
    const surface = [
      ...html.matchAll(/(?:href|src|action|hx-[a-z]+|formaction)="(?<url>[^"#][^"]*)"/gu),
    ]
      .map((match) => match.groups?.["url"] ?? "")
      .filter((url) => url.startsWith("/") && !url.startsWith("/assets/"))
      .map((url) =>
        url
          .replaceAll(seeded.publicId, ":build")
          .replaceAll(seeded.publicSnapshot, ":snapshot")
          .replaceAll(/v=[^&"]*/gu, "v=:v"),
      );
    expect([...new Set(surface)].toSorted()).toMatchSnapshot();
  });

  it("renders no write control for a failed or stale public build either", async () => {
    const seeded = await boot();
    for (const status of ["failed", "approved", "pending", "cancelled"] as const) {
      await new BuildModel(seeded.db).update(seeded.publicId, { status });
      const html = await (
        await anonymous(seeded, `/projects/demo/builds/${seeded.publicId}/diff`)
      ).text();
      expect(html, status).not.toMatch(/method="post"/iu);
      expect(html, status).not.toMatch(/hx-(?:post|put|patch|delete)=/u);
    }
  });

  it("answers a private build exactly like a missing one", async () => {
    const seeded = await boot();
    for (const suffix of ["", "/diff", "/diff?snapshot=x"]) {
      const [privateAnswer, missing] = await Promise.all([
        anonymous(seeded, `/projects/demo/builds/${seeded.privateId}${suffix}`),
        anonymous(seeded, `/projects/demo/builds/${UNKNOWN_ID}${suffix}`),
      ]);
      const seen = await observed(seeded, privateAnswer);
      expect(seen, suffix).toEqual(await observed(seeded, missing));
      expect(seen["status"], suffix).toBe(404);
    }
  });

  it("answers a build of another project exactly like a missing one", async () => {
    const seeded = await boot();
    const other = await anonymous(seeded, `/projects/demo/builds/${seeded.hiddenId}/diff`);
    const missing = await anonymous(seeded, `/projects/demo/builds/${UNKNOWN_ID}/diff`);
    expect(await observed(seeded, other)).toEqual(await observed(seeded, missing));
  });

  it("sends a visitor of a project with no public build to sign in, as for an unknown project", async () => {
    const seeded = await boot();
    for (const suffix of ["", "/builds", `/builds/${seeded.hiddenId}/diff`]) {
      const [hidden, unknown] = await Promise.all([
        anonymous(seeded, `/projects/hidden${suffix}`),
        anonymous(seeded, `/projects/ghost${suffix.replace(seeded.hiddenId, UNKNOWN_ID)}`),
      ]);
      const seen = await observed(seeded, hidden);
      expect(seen, suffix).toEqual(await observed(seeded, unknown));
      expect(seen["status"], suffix).toBe(302);
      // The project's own address redirects to its Library, which then asks to sign in.
      expect(String(seen["location"]), suffix).toMatch(
        suffix === "" ? /^\/projects\/:slug\/library$/u : /^\/auth\/login\?return_to=/u,
      );
    }
  });

  it("keeps every other project page behind sign-in", async () => {
    const seeded = await boot();
    for (const path of [
      "/projects/demo/library",
      "/projects/demo/settings",
      "/projects/demo/labels",
      `/projects/demo/builds/${seeded.publicId}/insights/panel`,
      "/projects",
      "/",
    ]) {
      const response = await anonymous(seeded, path);
      expect(response.status, path).toBe(302);
      expect(response.headers.get("location"), path).toMatch(/^\/auth\/login/u);
    }
  });

  it("leaves a signed-in member's view of the project unchanged", async () => {
    const seeded = await boot();
    const response = await seeded.app.request("/projects/demo/builds", {
      headers: { cookie: "storyshelf_session=dev", accept: "text/html" },
    });
    // The member has no role on the project: the standard 404, as before.
    expect(response.status).toBe(404);
  });
});

describe("anonymous images of a public build", () => {
  const kinds = ["image", "diff", "baseline"] as const;

  it("serves the screenshot and diff of a public build, privately", async () => {
    const seeded = await boot();
    for (const kind of ["image", "diff"]) {
      const response = await anonymous(
        seeded,
        mediaPath(seeded.publicId, seeded.publicSnapshot, kind),
        {
          accept: "image/png",
        },
      );
      expect(response.status, kind).toBe(200);
      expect(response.headers.get("cache-control"), kind).toBe("private, no-cache");
    }
  });

  it("answers every image of a private build exactly like a missing build's", async () => {
    const seeded = await boot();
    for (const kind of kinds) {
      const [privateAnswer, missing, otherProject] = await Promise.all([
        anonymous(seeded, mediaPath(seeded.privateId, seeded.privateSnapshot, kind)),
        anonymous(seeded, mediaPath(UNKNOWN_ID, UNKNOWN_ID, kind)),
        anonymous(
          seeded,
          `/api/v1/projects/hidden/builds/${seeded.hiddenId}/snapshots/${UNKNOWN_ID}/${kind}`,
        ),
      ]);
      const seen = await observed(seeded, privateAnswer);
      expect(seen, kind).toEqual(await observed(seeded, missing));
      expect(seen["status"], kind).toBe(404);
      const ghost = await anonymous(
        seeded,
        `/api/v1/projects/ghost/builds/${UNKNOWN_ID}/snapshots/${UNKNOWN_ID}/${kind}`,
      );
      expect(await observed(seeded, otherProject), kind).toEqual(await observed(seeded, ghost));
    }
  });

  it("does not open a private build's snapshot through a public build's address", async () => {
    const seeded = await boot();
    const response = await anonymous(
      seeded,
      mediaPath(seeded.publicId, seeded.privateSnapshot, "image"),
    );
    expect(response.status).toBe(404);
  });
});

/** Every write route of a project, with the public build and snapshot filled in. */
function writeRoutes(seeded: Seeded): { key: string; method: string; path: string }[] {
  return Object.keys({ ...API_ROUTE_CLASSES, ...PAGE_ROUTE_CLASSES })
    .filter((key) => key.includes("/:slug") && !/^(?:GET|HEAD) /u.test(key))
    .map((key) => {
      const [method = "POST", pattern = ""] = key.split(" ");
      const path = pattern
        .replace(":slug", "demo")
        .replace(":buildId", seeded.publicId)
        .replace(":snapshotId", seeded.publicSnapshot)
        .replaceAll(/:[a-zA-Z]+/gu, "x")
        .replaceAll("*", "x");
      return { key, method: method === "ALL" ? "POST" : method, path };
    });
}

describe("anonymous writes on a public build", () => {
  it("are refused on every write route, and nothing is written", async () => {
    const seeded = await boot();
    const before = await Promise.all([
      new CommentModel(seeded.db).listByBuild(seeded.publicId),
      new SnapshotModel(seeded.db).listByBuild(seeded.publicId),
      new BuildModel(seeded.db).get(seeded.publicId),
    ]);
    for (const route of writeRoutes(seeded)) {
      requests += 1;
      const response = await seeded.app.request(route.path, {
        method: route.method,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://shelf.example",
          "sec-fetch-site": "same-origin",
          "x-forwarded-for": `10.3.${Math.floor(requests / 250)}.${requests % 250}`,
        },
        body: "body=hello&verdict=approved&status=approved",
      });
      // Refused: a sign-in redirect, 401, 403, 404, or the body is refused before anything runs.
      expect(response.status >= 200 && response.status < 300, route.key).toBe(false);
    }
    const after = await Promise.all([
      new CommentModel(seeded.db).listByBuild(seeded.publicId),
      new SnapshotModel(seeded.db).listByBuild(seeded.publicId),
      new BuildModel(seeded.db).get(seeded.publicId),
    ]);
    expect(after).toEqual(before);
  });
});

describe("the login page's public link", () => {
  it("offers the builds of a public project to browse without an account", async () => {
    const seeded = await boot();
    const html = await (await anonymous(seeded, "/auth/login")).text();
    expect(html).toContain("Browse public builds without an account");
    expect(html).toContain('href="/projects/demo/builds"');
    expect(html).not.toContain("/projects/hidden");
  });

  it("offers nothing when no project has a public build", async () => {
    const seeded = await boot();
    await seeded.db.update(seeded.db.tables.projects, "p1", { publicBranchRegex: null });
    const html = await (await anonymous(seeded, "/auth/login")).text();
    expect(html).not.toContain("without an account");
  });
});
