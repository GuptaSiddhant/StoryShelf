/**
 * `subdomain` hosting (ADR 0051, decisions 1, 5, 8, 9, 12): host dispatch, content hosts for public and
 * private builds, the `/_x/` exchange and its cookie, the portal redirect, alias hosts, and the boot
 * refusals. Requests carry the `Host` through their URL, as a proxy that passes `Host` on would.
 */
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import {
  signStorybookToken,
  storybookDir,
  storybookExchangePath,
  type StorybookTokenPurpose,
} from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

const SECRET = "subdomain-secret-subdomain-secret-1";
const A = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const B = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const BASE = "shelf.example.com";
const PORTAL = `https://${BASE}`;
const hostOf = (id: string): string => `${id.toLowerCase()}.${BASE}`;
const admin = { id: "u1", email: "a@example.com", name: "Ada", role: "admin" as const };
const stranger = { id: "u2", email: "b@example.com", name: "Bo", role: "member" as const };
const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
const SCRIPT = { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" };

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
    gitBranch: "feature/x",
    isDefault: false,
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
  user?: typeof admin | typeof stranger | null;
  /** Build A is public (build B is always private). */
  publicA?: boolean;
  auth?: boolean;
}

async function boot(options: BootOptions = {}) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, project());
  await db.insert(db.tables.builds, build(A, { public: options.publicA === true }));
  await db.insert(db.tables.builds, build(B));
  for (const id of [A, B]) {
    const dir = storybookDir("p1", id);
    objects.set(`${dir}/index.html`, Buffer.from(`<html>manager ${id}</html>`));
    objects.set(`${dir}/iframe.html`, Buffer.from("<html>preview</html>"));
    objects.set(`${dir}/assets/app.js`, Buffer.from(`console.log("${id}")`));
  }
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    ...(options.auth === false
      ? {}
      : {
          auth: stubAuth(options.user === undefined ? admin : options.user, {
            hostSessionCookie: true,
          }),
        }),
    testing: { runner: stubRunner() },
    config: {
      secret: SECRET,
      publicBaseUrl: PORTAL,
      storybookHosting: { mode: "subdomain", baseDomain: BASE },
    },
  });
  return { app };
}

const get = (app: Awaited<ReturnType<typeof boot>>["app"], url: string, headers = {}) =>
  app.request(url, { headers });

const token = (purpose: StorybookTokenPurpose, buildId = A, now?: number): string =>
  signStorybookToken({ secret: SECRET, projectId: "p1", buildId, purpose, now });

/** Run the portal redirect and the exchange for `id`, answering the `Cookie` header the host set. */
async function signIn(app: Awaited<ReturnType<typeof boot>>["app"], id: string): Promise<string> {
  const hop = await get(app, `${PORTAL}/_/${id}/assets/app.js`, NAV);
  const exchange = await get(app, hop.headers.get("location") ?? "", NAV);
  const set = exchange.headers.get("set-cookie") ?? "";
  return set.split(";")[0] ?? "";
}

describe("host dispatch", () => {
  it.each([
    ["an unknown name", "https://evil.example.org/"],
    ["an IP", "http://203.0.113.7/"],
    ["a reserved label", `https://admin.${BASE}/`],
    ["a second label", `https://x.${hostOf(A)}/`],
    ["a trailing dot", `https://${hostOf(A)}./`],
    ["a build id on the wrong domain", `https://${A.toLowerCase()}.example.org/`],
  ])("answers 404 for %s", async (_name, url) => {
    const { app } = await boot();
    const response = await get(app, url, NAV);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("lets the portal host through to the portal", async () => {
    const { app } = await boot();
    expect((await get(app, `${PORTAL}/api/v1/health`)).status).toBe(200);
  });

  it("serves no portal path on a content host", async () => {
    const { app } = await boot({ publicA: true });
    for (const path of [
      "/api/v1/health",
      "/projects",
      "/auth/login",
      "/admin",
      "/_r/x.y",
      "/_s/x.y",
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await get(app, `https://${hostOf(A)}${path}`, NAV);
      expect(response.status, path).toBe(404);
    }
  });

  it("answers only reads on a content host and on an alias host", async () => {
    const { app } = await boot({ publicA: true });
    for (const url of [`https://${hostOf(A)}/assets/app.js`, `https://test-project.${BASE}/`]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await app.request(url, { method: "POST", headers: NAV });
      expect(response.status).toBe(404);
    }
  });
});

describe("a public build on its content host", () => {
  it("serves its files with no sandbox header, open CORS and public caching", async () => {
    const { app } = await boot({ publicA: true });
    const response = await get(app, `https://${hostOf(A)}/assets/app.js`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(A);
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("cross-origin-resource-policy")).toBeNull();
  });

  it("serves the build's index.html at the root, and only its own build", async () => {
    const { app } = await boot({ publicA: true });
    const root = await get(app, `https://${hostOf(A)}/`);
    expect(await root.text()).toContain(`manager ${A}`);
    expect((await get(app, `https://${hostOf(B)}/assets/app.js`)).status).toBe(404);
  });

  it("matches the host case-insensitively and refuses an unknown build", async () => {
    const { app } = await boot({ publicA: true });
    expect((await get(app, `https://${hostOf(A).toUpperCase()}/assets/app.js`)).status).toBe(200);
    expect(
      (await get(app, `https://${"01ARZ3NDEKTSV4RRFFQ69G5FAX".toLowerCase()}.${BASE}/`)).status,
    ).toBe(404);
  });

  it.each([
    "/%2e%2e/secret",
    "/assets/..%2f..%2fx",
    "/assets//app.js",
    "/assets%5Capp.js",
    "/a%00b",
  ])("refuses the path %s", async (path) => {
    const { app } = await boot({ publicA: true });
    expect((await get(app, `https://${hostOf(A)}${path}`)).status).toBe(404);
  });
});

describe("the portal never serves a build's bytes in subdomain mode", () => {
  it("sends a public build to its content host, keeping path and query", async () => {
    const { app } = await boot({ publicA: true });
    for (const url of [
      `${PORTAL}/_/${A}/iframe.html?id=a--b&viewMode=story`,
      `${PORTAL}/projects/test-project/storybook/build/${A}/iframe.html?id=a--b&viewMode=story`,
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await get(app, url, NAV);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `https://${hostOf(A)}/iframe.html?id=a--b&viewMode=story`,
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  it("sends the landing page to the content host as well", async () => {
    const { app } = await boot({ publicA: true });
    const response = await get(app, `${PORTAL}/projects/test-project/storybook/build/${A}/`, NAV);
    expect(response.headers.get("location")).toBe(`https://${hostOf(A)}/`);
  });

  it("maps a storyId link to the manager's own path parameter", async () => {
    const { app } = await boot({ publicA: true });
    const base = `${PORTAL}/projects/test-project/storybook/build/${A}/`;
    const story = await get(app, `${base}?storyId=button--primary`, NAV);
    expect(story.headers.get("location")).toBe(
      `https://${hostOf(A)}/?path=${encodeURIComponent("/story/button--primary")}`,
    );
    const docs = await get(app, `${base}?storyId=button--primary&viewMode=docs`, NAV);
    expect(docs.headers.get("location")).toBe(
      `https://${hostOf(A)}/?path=${encodeURIComponent("/docs/button--primary")}`,
    );
    const bad = await get(app, `${base}?storyId=${encodeURIComponent("<x>")}`, NAV);
    expect(bad.headers.get("location")).toBe(`https://${hostOf(A)}/?storyId=%3Cx%3E`);
  });

  it("sends a private build through the exchange with a 60 second token", async () => {
    const { app } = await boot();
    const response = await get(app, `${PORTAL}/_/${B}/assets/app.js?x=1`, NAV);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe(`https://${hostOf(B)}`);
    expect(location.pathname).toMatch(/^\/_x\/[\w-]+\.[\w-]{43}\/assets\/app\.js$/u);
    expect(location.search).toBe("?x=1");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("answers a request that is not a navigation with the identical 404", async () => {
    const { app } = await boot();
    for (const headers of [{}, SCRIPT, { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await get(app, `${PORTAL}/_/${B}/assets/app.js`, headers);
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("answers a viewer with no role as for a missing build", async () => {
    const { app } = await boot({ user: stranger });
    const missing = await get(app, `${PORTAL}/_/01ARZ3NDEKTSV4RRFFQ69G5FAX/x`, NAV);
    const hidden = await get(app, `${PORTAL}/_/${B}/x`, NAV);
    expect(hidden.status).toBe(missing.status);
    expect(hidden.headers.get("location")).toBeNull();
  });
});

describe("the exchange and the grant cookie", () => {
  it("sets a host-only, __Host- cookie and redirects to the clean URL", async () => {
    const { app } = await boot();
    const hop = await get(app, `${PORTAL}/_/${B}/assets/app.js?x=1`, NAV);
    const exchange = await get(app, hop.headers.get("location") ?? "", NAV);
    expect(exchange.status).toBe(302);
    expect(exchange.headers.get("location")).toBe("/assets/app.js?x=1");
    const cookie = exchange.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-storyshelf-grant=[\w-]+\.[\w-]{43}; /u);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).not.toMatch(/Domain=/iu);
    expect(exchange.headers.get("cache-control")).toContain("no-store");
    expect(exchange.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("never puts the exchange token in the cookie", async () => {
    const { app } = await boot();
    const hop = await get(app, `${PORTAL}/_/${B}/`, NAV);
    const exchangeToken = (hop.headers.get("location") ?? "").split("/_x/")[1]?.split("/")[0];
    const exchange = await get(app, hop.headers.get("location") ?? "", NAV);
    expect(exchange.headers.get("set-cookie")).not.toContain(exchangeToken ?? "-");
  });

  it("serves the private build with the cookie: private, revalidated, CORP same-origin", async () => {
    const { app } = await boot();
    const cookie = await signIn(app, B);
    const response = await get(app, `https://${hostOf(B)}/assets/app.js`, { ...SCRIPT, cookie });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(B);
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
    const etag = response.headers.get("etag") ?? "";
    expect(etag).not.toBe("");
    const again = await get(app, `https://${hostOf(B)}/assets/app.js`, {
      ...SCRIPT,
      cookie,
      "if-none-match": etag,
    });
    expect(again.status).toBe(304);
  });

  it("sends a navigation without the cookie to the portal, and refuses any other request", async () => {
    const { app } = await boot();
    const bounced = await get(app, `https://${hostOf(B)}/iframe.html?id=a`, NAV);
    expect(bounced.status).toBe(302);
    expect(bounced.headers.get("location")).toBe(`${PORTAL}/_/${B}/iframe.html?id=a`);
    const script = await get(app, `https://${hostOf(B)}/assets/app.js`, SCRIPT);
    expect(script.status).toBe(404);
    expect(script.headers.get("location")).toBeNull();
  });

  it("refuses build A's cookie on build B's host", async () => {
    const { app } = await boot({ publicA: false });
    const cookieA = await signIn(app, A);
    expect(
      (await get(app, `https://${hostOf(A)}/assets/app.js`, { ...SCRIPT, cookie: cookieA })).status,
    ).toBe(200);
    const onB = await get(app, `https://${hostOf(B)}/assets/app.js`, {
      ...SCRIPT,
      cookie: cookieA,
    });
    expect(onB.status).toBe(404);
    expect(await onB.text()).not.toContain(B);
  });

  it("refuses a forged, expired or wrong-purpose cookie", async () => {
    const { app } = await boot();
    const sealed = token("cookie", B);
    const expired = token("cookie", B, Date.now() - 2 * 3600 * 1000);
    const [payload = ""] = sealed.split(".");
    for (const value of [
      `${payload}.${"A".repeat(43)}`,
      expired,
      token("exchange", B),
      token("read", B),
      token("capture", B),
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await get(app, `https://${hostOf(B)}/assets/app.js`, {
        ...SCRIPT,
        cookie: `__Host-storyshelf-grant=${value}`,
      });
      expect(response.status, value).toBe(404);
    }
    const ok = await get(app, `https://${hostOf(B)}/assets/app.js`, {
      ...SCRIPT,
      cookie: `__Host-storyshelf-grant=${sealed}`,
    });
    expect(ok.status).toBe(200);
  });

  it("refuses an exchange that is not a navigation, sets no cookie", async () => {
    const { app } = await boot();
    const url = `https://${hostOf(B)}${storybookExchangePath(token("exchange", B))}assets/app.js`;
    for (const headers of [{}, SCRIPT, { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await get(app, url, headers);
      expect(response.status).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect((await get(app, url, NAV)).status).toBe(302);
  });

  it("refuses an exchange token for another build, an expired one and one of another purpose", async () => {
    const { app } = await boot();
    const attempts = [
      token("exchange", A),
      token("exchange", B, Date.now() - 120_000),
      token("read", B),
      token("capture", B),
      token("cookie", B),
    ];
    for (const value of attempts) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await get(app, `https://${hostOf(B)}${storybookExchangePath(value)}`, NAV);
      expect(response.status, value).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("does not accept an exchange or cookie token on /_r/ or /_s/, nor a read token on /_x/", async () => {
    const { app } = await boot();
    for (const purpose of ["exchange", "cookie"] as const) {
      for (const prefix of ["/_r/", "/_s/"]) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
        const response = await get(app, `${PORTAL}${prefix}${token(purpose, B)}/assets/app.js`);
        expect(response.status, `${prefix}${purpose}`).toBe(404);
      }
    }
  });

  it("refuses an exchange once the build is gone or the project no longer matches", async () => {
    const { app } = await boot();
    const other = signStorybookToken({
      secret: SECRET,
      projectId: "p2",
      buildId: B,
      purpose: "exchange",
    });
    const response = await get(app, `https://${hostOf(B)}${storybookExchangePath(other)}`, NAV);
    expect(response.status).toBe(404);
  });

  it("keeps the exchange redirect on the host, whatever the path says", async () => {
    const { app } = await boot();
    const base = `https://${hostOf(B)}${storybookExchangePath(token("exchange", B))}`;
    for (const rest of ["%2F%2Fevil.example.org", "..%2F..", "%5Cevil.example.org"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await get(app, `${base}${rest}`, NAV);
      expect([rest, response.status, response.headers.get("location")]).toEqual([rest, 404, null]);
    }
  });
});

describe("alias hosts", () => {
  it("redirect every path to the portal's project Storybook, keeping only the query", async () => {
    const { app } = await boot();
    for (const [path, search] of [
      ["/", ""],
      ["/anything?x=1", "?x=1"],
      ["/iframe.html", ""],
    ] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential, short
      const response = await get(app, `https://test-project.${BASE}${path}`, NAV);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `${PORTAL}/projects/test-project/storybook${search}`,
      );
    }
  });

  it("resolve nothing themselves: a slug that does not exist redirects the same", async () => {
    const { app } = await boot();
    const response = await get(app, `https://nope.${BASE}/`);
    expect(response.headers.get("location")).toBe(`${PORTAL}/projects/nope/storybook`);
  });
});

describe("a deployment without sign-in", () => {
  it("serves every build on its content host without a cookie", async () => {
    const { app } = await boot({ auth: false });
    expect((await get(app, `https://${hostOf(B)}/assets/app.js`)).status).toBe(200);
  });
});

describe("deprecated publishedBaseDomain", () => {
  it("is read as subdomain hosting, with a deprecation warning", async () => {
    const warn = vi.fn();
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, project());
    await db.insert(db.tables.builds, build(A));
    objects.set(`${storybookDir("p1", A)}/assets/app.js`, Buffer.from("x"));
    const logger = pino({ level: "silent" });
    logger.warn = warn as never;
    const app = createShelfApp({
      database: db,
      storage,
      logger,
      config: { publishedBaseDomain: BASE, publicBaseUrl: PORTAL },
    });
    expect((await app.request(`https://${hostOf(A)}/assets/app.js`)).status).toBe(200);
    expect(JSON.stringify(warn.mock.calls)).toContain("publishedBaseDomain is deprecated");
  });
});

/** An attempt to boot with `config`, as a function so a test can expect it to throw. */
const make = (config: Record<string, unknown>, auth = true) => {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  return () =>
    createShelfApp({
      database: db,
      storage,
      logger: pino({ level: "silent" }),
      ...(auth ? { auth: stubAuth(admin, { hostSessionCookie: true }) } : {}),
      config: { secret: SECRET, ...config },
    });
};

describe("boot refusals", () => {
  const sub = { storybookHosting: { mode: "subdomain" as const, baseDomain: BASE } };

  it.each([
    ["no portal origin", { ...sub }, /publicBaseUrl/u],
    ["an http portal", { ...sub, publicBaseUrl: `http://${BASE}` }, /https/u],
    [
      "a portal one label under the base domain",
      { storybookHosting: { mode: "subdomain", baseDomain: "example.com" }, publicBaseUrl: PORTAL },
      /would also match the portal host/u,
    ],
  ])("refuses %s", (_name, config, message) => {
    expect(make(config)).toThrow(message);
  });

  it("refuses sign-in without the __Host- cookie engine", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    expect(() =>
      createShelfApp({
        database: db,
        storage,
        auth: stubAuth(admin),
        config: { secret: SECRET, publicBaseUrl: PORTAL, ...sub },
      }),
    ).toThrow(/__Host- session cookie/u);
  });

  it("accepts a portal equal to the base domain and a localhost name over http", () => {
    expect(make({ ...sub, publicBaseUrl: PORTAL })).not.toThrow();
    expect(
      make({
        storybookHosting: { mode: "subdomain", baseDomain: "localhost" },
        publicBaseUrl: "http://localhost:3000",
      }),
    ).not.toThrow();
  });
});
