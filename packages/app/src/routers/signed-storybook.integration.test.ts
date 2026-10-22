import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { signStorybookToken, storybookDir } from "@storyshelf/core/utils";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

const SECRET = "signed-url-secret-signed-url-secret";
const apps: ReturnType<typeof createShelfApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

function project(id: string, slug: string): Project {
  return {
    id,
    name: slug,
    slug,
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
  } as Project;
}

function build(id: string, projectId: string): Build {
  return {
    id,
    projectId,
    gitSha: `sha-${id}`,
    gitBranch: "feature",
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
    affectedOnly: true,
    baselineSha: null,
    changedFiles: null,
    affectedImportPaths: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Build;
}

interface Boot {
  db: ReturnType<typeof makeDatabase>["db"];
  app: ReturnType<typeof createShelfApp>;
  token: (overrides?: {
    buildId?: string;
    projectId?: string;
    secret?: string;
    now?: number;
  }) => string;
}

async function boot(
  options: {
    testing?: boolean;
    config?: Record<string, unknown>;
    rateLimit?: number;
    projectTtl?: number;
  } = {},
): Promise<Boot> {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, {
    ...project("p1", "one"),
    ...(options.projectTtl === undefined ? {} : { storybookUrlTtlSeconds: options.projectTtl }),
  });
  await db.insert(db.tables.projects, project("p2", "two"));
  await db.insert(db.tables.builds, build("b1", "p1"));
  await db.insert(db.tables.builds, build("b2", "p2"));
  const dir1 = storybookDir("p1", "b1");
  objects.set(`${dir1}/index.html`, Buffer.from("<html>manager</html>"));
  objects.set(`${dir1}/iframe.html`, Buffer.from("<html>preview one</html>"));
  objects.set(`${dir1}/assets/iframe-abc.js`, Buffer.from("console.log(1)"));
  objects.set(`${dir1}/sb-common-assets/font.woff2`, Buffer.from([1, 2, 3]));
  objects.set(`${storybookDir("p2", "b2")}/iframe.html`, Buffer.from("<html>preview two</html>"));
  objects.set("secret.txt", Buffer.from("top secret"));
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    auth: stubAuth(null),
    config: { secret: SECRET, ...options.config },
    ...(options.testing === false
      ? {}
      : {
          testing: {
            runner: stubRunner(),
            ...(options.rateLimit === undefined
              ? {}
              : { storybookUrlRateLimit: options.rateLimit }),
          },
        }),
  });
  apps.push(app);
  return {
    app,
    db,
    token: (overrides = {}) =>
      signStorybookToken({
        secret: overrides.secret ?? SECRET,
        projectId: overrides.projectId ?? "p1",
        buildId: overrides.buildId ?? "b1",
        now: overrides.now,
      }),
  };
}

describe("GET /_s/:token/*", () => {
  it("serves a private build's files without any session", async () => {
    const { app, token } = await boot();
    const t = token();
    const iframe = await app.request(`/_s/${t}/iframe.html`);
    expect(iframe.status).toBe(200);
    expect(await iframe.text()).toBe("<html>preview one</html>");
    expect(iframe.headers.get("content-type")).toContain("text/html");
    const asset = await app.request(`/_s/${t}/assets/iframe-abc.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect((await app.request(`/_s/${t}/sb-common-assets/font.woff2`)).status).toBe(200);
    expect((await app.request(`/_s/${t}/iframe.html`, { method: "HEAD" })).status).toBe(200);
  });

  it("answers private, unindexed, referrer-less, uncached", async () => {
    const { app, token } = await boot();
    for (const response of [
      await app.request(`/_s/${token()}/iframe.html`),
      await app.request(`/_s/${token()}/missing.js`),
      await app.request(`/_s/garbage/iframe.html`),
    ]) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("opens CORS to a sandboxed frame for a served file, never for a refusal, never with credentials", async () => {
    const { app, token } = await boot();
    const served = await app.request(`/_s/${token()}/assets/iframe-abc.js`);
    expect(served.headers.get("access-control-allow-origin")).toBe("*");
    expect(served.headers.get("access-control-allow-credentials")).toBeNull();
    for (const refused of [
      await app.request(`/_s/${token()}/missing.js`),
      await app.request(`/_s/garbage/iframe.html`),
    ]) {
      expect(refused.status).toBe(404);
      expect(refused.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("serves through the published-file handler: same bytes and type as the signed-in route", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, project("p1", "one"));
    await db.insert(db.tables.builds, build("b1", "p1"));
    objects.set(`${storybookDir("p1", "b1")}/assets/app.js`, Buffer.from("console.log(2)"));
    const user = { id: "u1", email: "a@example.com", name: "Ada", role: "admin" as const };
    const app = createShelfApp({
      database: db,
      storage,
      logger: pino({ level: "silent" }),
      auth: stubAuth(user),
      config: { secret: SECRET },
      testing: { runner: stubRunner() },
    });
    apps.push(app);
    const token = signStorybookToken({ secret: SECRET, projectId: "p1", buildId: "b1" });
    const viaSession = await app.request("/projects/one/storybook/build/b1/assets/app.js");
    const viaToken = await app.request(`/_s/${token}/assets/app.js`);
    expect(await viaToken.text()).toBe(await viaSession.text());
    expect(viaToken.headers.get("content-type")).toBe(viaSession.headers.get("content-type"));
    // Only the token answer is private; only the session answer is withheld from CORS.
    expect(viaToken.headers.get("cache-control")).toBe("private, no-store");
    expect(viaSession.headers.get("cache-control")).toContain("immutable");
    expect(viaToken.headers.get("access-control-allow-origin")).toBe("*");
    expect(viaSession.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("is a different route from the /_/ short link, which it never shadows or answers for", async () => {
    const { app, token } = await boot();
    // A token is no short-link id, and a build id is no token.
    expect((await app.request(`/_/${token()}/iframe.html`)).status).not.toBe(200);
    expect((await app.request(`/_s/b1/iframe.html`)).status).toBe(404);
    expect((await app.request(`/_s/`)).status).toBe(404);
    // The old prefix and the bare one are not the token route: the sign-in gate answers.
    expect((await app.request(`/_s`)).status).toBe(302);
    expect((await app.request(`/s/${token()}/iframe.html`)).status).toBe(302);
  });

  it("rate limits per client IP before it looks at the token, with one 429 for every token", async () => {
    const { app, token } = await boot({ rateLimit: 3 });
    const forwarded = { headers: { "x-forwarded-for": "203.0.113.7" } };
    const first = await Promise.all(
      [token(), token(), "garbage"].map(
        async (value) => await app.request(`/_s/${value}/iframe.html`, forwarded),
      ),
    );
    expect(first.map((response) => response.status)).toEqual([200, 200, 404]);
    const limited = [
      await app.request(`/_s/${token()}/iframe.html`, forwarded),
      await app.request(`/_s/garbage/iframe.html`, forwarded),
    ];
    expect(limited.map((response) => response.status)).toEqual([429, 429]);
    expect(await limited[0]?.text()).toBe(await limited[1]?.text());
    expect(limited[0]?.headers.get("retry-after")).not.toBeNull();
    // Another address has its own budget.
    const other = await app.request(`/_s/${token()}/iframe.html`, {
      headers: { "x-forwarded-for": "198.51.100.9" },
    });
    expect(other.status).toBe(200);
  });

  it("allows a farm thousands of requests a minute by default", async () => {
    const { app, token } = await boot();
    const t = token();
    const statuses = await Promise.all(
      Array.from({ length: 300 }, async () => (await app.request(`/_s/${t}/iframe.html`)).status),
    );
    expect(new Set(statuses)).toEqual(new Set([200]));
  });

  it("answers 404 alike for a bad, tampered, foreign-secret, expired or unknown-build token", async () => {
    const { app, token } = await boot();
    const good = token();
    const [payload = "", signature = ""] = good.split(".");
    const bad = [
      "garbage",
      `${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`,
      `${token({ buildId: "b2" }).split(".")[0]}.${signature}`,
      token({ secret: "another-secret" }),
      token({ now: Date.now() - 3 * 3600_000 }),
      token({ buildId: "gone" }),
    ];
    const responses = await Promise.all(
      bad.map(async (value) => await app.request(`/_s/${value}/iframe.html`)),
    );
    expect(responses.map((response) => response.status)).toEqual(bad.map(() => 404));
    const bodies = await Promise.all(responses.map(async (response) => await response.text()));
    expect(new Set(bodies).size).toBe(1);
  });

  it("never lets a build's token read another build or project", async () => {
    const { app, token } = await boot();
    expect(
      await (
        await app.request(`/_s/${token({ projectId: "p2", buildId: "b2" })}/iframe.html`)
      ).text(),
    ).toBe("<html>preview two</html>");
    // b1 under p2: the build does not belong to the project the token names.
    expect(
      (await app.request(`/_s/${token({ projectId: "p2", buildId: "b1" })}/iframe.html`)).status,
    ).toBe(404);
    expect(
      (await app.request(`/_s/${token({ projectId: "p1", buildId: "b2" })}/iframe.html`)).status,
    ).toBe(404);
  });

  it("serves no wrapper or index page for the empty path, and no directory", async () => {
    const { app, token } = await boot();
    expect((await app.request(`/_s/${token()}/`)).status).toBe(404);
    expect((await app.request(`/_s/${token()}`)).status).toBe(404);
    expect((await app.request(`/_s/${token()}/assets/`)).status).toBe(404);
    expect((await app.request(`/_s/${token()}/assets`)).status).toBe(404);
  });

  it("refuses traversal, odd segments and encodings", async () => {
    const { app, token } = await boot();
    const t = token();
    const paths = [
      "../secret.txt",
      "..%2fsecret.txt",
      "%2e%2e/secret.txt",
      "%2e%2e%2fsecret.txt",
      "assets/..%2f..%2f..%2fsecret.txt",
      "assets/%252e%252e/secret.txt",
      "..%5csecret.txt",
      "assets//iframe-abc.js",
      "%00iframe.html",
      "iframe.html%00",
      "%ZZ",
      "....//secret.txt",
    ];
    const responses = await Promise.all(
      paths.map(async (path) => await app.request(`/_s/${t}/${path}`)),
    );
    expect(responses.map((response) => response.status)).toEqual(paths.map(() => 404));
    const bodies = await Promise.all(responses.map(async (response) => await response.text()));
    expect(bodies.join("")).not.toContain("secret");
  });

  it("accepts a token signed with the previous secret during a rotation", async () => {
    const { app, token } = await boot({
      config: { secret: "the-new-secret-the-new-secret", previousSecret: SECRET },
    });
    expect((await app.request(`/_s/${token()}/iframe.html`)).status).toBe(200);
    const { app: rotatedOut, token: stale } = await boot({
      config: { secret: "the-new-secret-the-new-secret" },
    });
    expect((await rotatedOut.request(`/_s/${stale()}/iframe.html`)).status).toBe(404);
  });

  it("is a GET route only", async () => {
    const { app, token } = await boot();
    const responses = await Promise.all(
      ["POST", "PUT", "DELETE", "PATCH"].map(
        async (method) =>
          await app.request(`/_s/${token()}/iframe.html`, {
            method,
            ...(method === "DELETE" ? {} : { body: "{}" }),
          }),
      ),
    );
    expect(responses.every((response) => response.status >= 400)).toBe(true);
  });

  it("answers 404 as if absent without `testing`", async () => {
    const { app, token } = await boot({ testing: false });
    expect((await app.request(`/_s/${token()}/iframe.html`)).status).toBe(404);
  });

  it("stops serving a purged build", async () => {
    const { app, db, token } = await boot();
    const t = token();
    expect((await app.request(`/_s/${t}/iframe.html`)).status).toBe(200);
    await db.remove(db.tables.builds, "b1");
    expect((await app.request(`/_s/${t}/iframe.html`)).status).toBe(404);
  });
});
