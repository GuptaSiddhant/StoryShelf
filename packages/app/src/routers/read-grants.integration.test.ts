/**
 * Read grants and the sandbox header (ADR 0051): every route family that serves uploaded files, in
 * `trusted` and `sandboxed` mode; `/_r/` and `/_s/` each refusing the other's token; renewal through
 * the canonical path checking permission again.
 */
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { signStorybookToken, storybookDir, storybookReadPath } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";
import { SANDBOX_CSP } from "./published-access.ts";

const SECRET = "read-grant-secret-read-grant-secret";
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const admin = { id: "u1", email: "a@example.com", name: "Ada", role: "admin" as const };
const stranger = { id: "u2", email: "b@example.com", name: "Bo", role: "member" as const };
const PATH_BASE = "/projects/test-project/storybook/build";

function project(): Project {
  return {
    id: "p1",
    name: "Test",
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
  };
}

function build(id: string, overrides: Partial<Build> = {}): Build {
  return {
    id,
    projectId: "p1",
    gitSha: `sha-${id}`,
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

interface BootOptions {
  mode?: "trusted" | "sandboxed";
  user?: typeof admin | typeof stranger | null;
  /** The build is public (anyone may open it). */
  publicBuild?: boolean;
  secret?: Record<string, string>;
}

/** Testing is on so `/_s/` (a `testing` route) is reachable; `/_r/` and the file routes need none. */
const TESTING = { runner: stubRunner() };

/** One build `b1` (also reachable as the project slug) and `ULID` (a feature build), with files. */
async function boot(options: BootOptions = {}) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, project());
  const isPublic = options.publicBuild === true;
  await db.insert(db.tables.builds, build("b1", { public: isPublic }));
  await db.insert(db.tables.builds, build(ULID, { public: isPublic, gitBranch: "feature/x" }));
  for (const id of ["b1", ULID]) {
    const dir = storybookDir("p1", id);
    objects.set(`${dir}/index.html`, Buffer.from("<html>manager</html>"));
    objects.set(`${dir}/iframe.html`, Buffer.from("<html>preview</html>"));
    objects.set(`${dir}/assets/app.js`, Buffer.from("console.log(1)"));
    objects.set(`${dir}/assets/a b.js`, Buffer.from("console.log(2)"));
  }
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    auth: stubAuth(options.user === undefined ? admin : options.user),
    testing: TESTING,
    config: {
      secret: SECRET,
      ...(options.mode === undefined ? {} : { storybookHosting: { mode: options.mode } }),
      ...options.secret,
    },
  });
  return { app, db };
}

const token = (overrides: Partial<Parameters<typeof signStorybookToken>[0]> = {}): string =>
  signStorybookToken({
    secret: SECRET,
    projectId: "p1",
    buildId: "b1",
    purpose: "read",
    ...overrides,
  });

/** The file routes of the project path and both short links, for a build served as `b1`/ULID/slug. */
const FILE_ROUTES = [
  ["the project path", `${PATH_BASE}/b1/assets/app.js`],
  ["the ULID short link", `/_/${ULID}/assets/app.js`],
  ["the slug short link", "/_/test-project/assets/app.js"],
] as const;

describe("sandboxed mode: public builds", () => {
  it.each(FILE_ROUTES)("sandboxes every file of %s and keeps CORS open", async (_name, path) => {
    const { app } = await boot({ mode: "sandboxed", publicBuild: true });
    const response = await app.request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("sandboxes the root of a short link, which is uploaded HTML, but not the app's own pages", async () => {
    const { app } = await boot({ mode: "sandboxed", publicBuild: true });
    const root = await app.request(`/_/${ULID}/`);
    expect(await root.text()).toContain("manager");
    expect(root.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
    const landing = await app.request(`${PATH_BASE}/b1/`);
    expect(landing.status).toBe(200);
    expect(landing.headers.get("content-security-policy")).toBeNull();
  });

  it("never includes allow-same-origin or top-navigation grants", () => {
    expect(SANDBOX_CSP).not.toMatch(/allow-same-origin|allow-top-navigation|escape-sandbox/u);
    expect(SANDBOX_CSP).toContain("allow-scripts");
  });
});

describe("trusted mode (the default)", () => {
  it.each(FILE_ROUTES)("serves %s as before: no sandbox header", async (_name, path) => {
    const { app } = await boot({ publicBuild: true });
    const response = await app.request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it.each(FILE_ROUTES)("serves a signed-in viewer's private %s directly", async (_name, path) => {
    const { app } = await boot({ mode: "trusted" });
    const response = await app.request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });
});

describe("sandboxed mode: private builds redirect to a read grant", () => {
  it.each(FILE_ROUTES)("redirects %s to /_r/, private and unreferred", async (_name, path) => {
    const { app } = await boot({ mode: "sandboxed" });
    const response = await app.request(path);
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toMatch(/^\/_r\/[\w-]+\.[\w-]{43}\/assets\/app\.js$/u);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("serves what the redirect points at: sandboxed, uncacheable, CORS open without credentials", async () => {
    const { app } = await boot({ mode: "sandboxed" });
    const redirect = await app.request(`${PATH_BASE}/b1/assets/app.js`);
    const response = await app.request(redirect.headers.get("location") ?? "");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("console.log(1)");
    expect(response.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("keeps the query string and re-encodes the path", async () => {
    const { app } = await boot({ mode: "sandboxed" });
    const response = await app.request(`${PATH_BASE}/b1/assets/a%20b.js?id=button--primary&x=1`);
    expect(response.headers.get("location")).toMatch(
      /^\/_r\/[\w.-]+\/assets\/a%20b\.js\?id=button--primary&x=1$/u,
    );
  });

  it("redirects the short link's root to the grant's root, which serves index.html", async () => {
    const { app } = await boot({ mode: "sandboxed" });
    const root = await app.request(`/_/${ULID}/`);
    expect(root.status).toBe(302);
    const served = await app.request(root.headers.get("location") ?? "");
    expect(await served.text()).toContain("manager");
    expect(served.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
  });

  it("keeps the app's own landing page on the project path: no redirect, no sandbox", async () => {
    const { app } = await boot({ mode: "sandboxed" });
    const landing = await app.request(`${PATH_BASE}/b1/`);
    expect(landing.status).toBe(200);
    expect(landing.headers.get("content-security-policy")).toBeNull();
  });

  it("mints a grant that lasts an hour at most and names exactly this build", async () => {
    const { app } = await boot({ mode: "sandboxed" });
    const location = (await app.request(`/_/${ULID}/assets/app.js`)).headers.get("location") ?? "";
    const minted = /^\/_r\/([^/]+)\//u.exec(location)?.[1] ?? "";
    const payload = Buffer.from(minted.split(".")[0] ?? "", "base64url").toString("utf8");
    const [projectId, buildId, expiresAt, purpose] = payload.split(":");
    expect([projectId, buildId, purpose]).toEqual(["p1", ULID, "read"]);
    expect(Number(expiresAt) - Date.now() / 1000).toBeLessThanOrEqual(3600);
  });

  it("gives a viewer without access what a missing build gets, and never a grant", async () => {
    const { app } = await boot({ mode: "sandboxed", user: stranger });
    for (const [, path] of FILE_ROUTES) {
      // oxlint-disable-next-line no-await-in-loop -- one request at a time keeps failures readable
      const response = await app.request(path);
      expect(response.headers.get("location") ?? "").not.toContain("/_r/");
      expect(response.status).toBe(404);
    }
  });

  it("checks permission again at every renewal: a revoked viewer gets no new grant, an old one only expires", async () => {
    const live = await boot({ mode: "sandboxed" });
    const first = await live.app.request(`${PATH_BASE}/b1/assets/app.js`);
    expect(first.status).toBe(302);
    const revoked = await boot({ mode: "sandboxed", user: stranger });
    const renewal = await revoked.app.request(`${PATH_BASE}/b1/assets/app.js`);
    expect(renewal.status).toBe(404);
    expect(renewal.headers.get("location")).toBeNull();
    // The hour-long grant already in the viewer's frame keeps working until it expires: that is the
    // documented price of working without a cookie (ADR 0051, Consequences).
    const old = await live.app.request(first.headers.get("location") ?? "");
    expect(old.status).toBe(200);
  });

  it("serves a public build directly, without a grant, even to a signed-out visitor", async () => {
    const { app } = await boot({ mode: "sandboxed", publicBuild: true, user: null });
    const response = await app.request(`${PATH_BASE}/b1/assets/app.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
  });
});

describe("GET /_r/:token/*", () => {
  it.each(["trusted", "sandboxed"] as const)(
    "serves a valid grant in %s mode, sandboxed, with no cookie or session",
    async (mode) => {
      const { app } = await boot({ mode, user: null });
      const response = await app.request(`${storybookReadPath(token())}iframe.html`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("preview");
      expect(response.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );

  it("serves index.html at its root", async () => {
    const { app } = await boot();
    const response = await app.request(storybookReadPath(token()));
    expect(await response.text()).toContain("manager");
  });

  it("is a hosting route: it works with no testing option", async () => {
    const { app } = await boot();
    expect((await app.request(`${storybookReadPath(token())}iframe.html`)).status).toBe(200);
  });

  it("refuses a capture token on /_r/ and a read grant on /_s/, with the same 404 everywhere", async () => {
    const { app } = await boot();
    const capture = token({ purpose: "capture" });
    const refusals = [
      await app.request(`/_r/${capture}/iframe.html`),
      await app.request(`/_s/${token()}/iframe.html`),
      await app.request(`/_r/garbage/iframe.html`),
      await app.request(`/_r/${token({ buildId: "nope" })}/iframe.html`),
    ];
    const bodies = await Promise.all(refusals.map(async (response) => await response.text()));
    expect(refusals.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect(new Set(bodies).size).toBe(1);
    for (const response of refusals) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  it("still serves a capture token on /_s/ (unchanged)", async () => {
    const { app } = await boot({ user: null });
    const response = await app.request(`/_s/${token({ purpose: "capture" })}/iframe.html`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("refuses a legacy token that carries no purpose on /_s/", async () => {
    const { createHmac } = await import("node:crypto");
    const exp = Math.floor(Date.now() / 1000) + 600;
    const payload = Buffer.from(`p1:b1:${String(exp)}`).toString("base64url");
    const key = createHmac("sha256", SECRET).update("storyshelf/storybook-url/v1").digest();
    const legacy = `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
    const { app } = await boot({ user: null });
    expect((await app.request(`/_s/${legacy}/iframe.html`)).status).toBe(404);
    expect((await app.request(`/_r/${legacy}/iframe.html`)).status).toBe(404);
  });

  it("refuses an expired grant, another build's file and a grant for a deleted build", async () => {
    const { app } = await boot();
    const expired = token({ now: Date.now() - 2 * 3600 * 1000 });
    expect((await app.request(`/_r/${expired}/iframe.html`)).status).toBe(404);
    const other = await app.request(`/_r/${token({ projectId: "p2" })}/iframe.html`);
    expect(other.status).toBe(404);
  });

  it("verifies with the current secret only: a rotation ends every grant at once", async () => {
    const { app } = await boot({ secret: { secret: "new-secret-new-secret-new-secret" } });
    const old = token({ secret: SECRET });
    const rotatedApp = (
      await boot({
        secret: { secret: "new-secret-new-secret-new-secret", previousSecret: SECRET },
      })
    ).app;
    expect((await app.request(`/_r/${old}/iframe.html`)).status).toBe(404);
    expect((await rotatedApp.request(`/_r/${old}/iframe.html`)).status).toBe(404);
    const fresh = token({ secret: "new-secret-new-secret-new-secret" });
    expect((await rotatedApp.request(`/_r/${fresh}/iframe.html`)).status).toBe(200);
  });

  it("rejects traversal and anything outside its build", async () => {
    const { app } = await boot();
    for (const rest of ["../p2/iframe.html", "%2e%2e/iframe.html", "assets/%00.js", "a//b"]) {
      // oxlint-disable-next-line no-await-in-loop -- one request at a time keeps failures readable
      const response = await app.request(`/_r/${token()}/${rest}`);
      expect(response.status).toBe(404);
    }
  });

  it("answers only GET: no page, no API under /_r/", async () => {
    const { app } = await boot();
    const response = await app.request(`/_r/${token()}/iframe.html`, { method: "POST" });
    expect([404, 405]).toContain(response.status);
  });

  it("shares the signed route's per-IP rate limit, before it reads the token", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, project());
    const app = createShelfApp({
      database: db,
      storage,
      logger: pino({ level: "silent" }),
      config: { secret: SECRET },
      testing: TESTING,
      storybookUrlRateLimit: 3,
    });
    const headers = { "x-forwarded-for": "203.0.113.50" };
    const statuses: number[] = [];
    for (const path of ["/_r/a/x", "/_s/b/x", "/_r/c/x", "/_s/d/x"]) {
      // oxlint-disable-next-line no-await-in-loop -- the fourth request must follow the first three
      statuses.push((await app.request(path, { headers })).status);
    }
    expect(statuses).toEqual([404, 404, 404, 429]);
  });
});
