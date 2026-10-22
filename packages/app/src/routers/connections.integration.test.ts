import { ConnectionModel, DesignCredentialModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { createFigmaDesign } from "@storyshelf/design-figma";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";
import { signState } from "./oauth-state.ts";

const SECRET = "connections-test-secret";
const NOW = "2026-01-01T00:00:00.000Z";
const BASE = "https://shelf.test";
const NODE_URL = "https://www.figma.com/design/KEY/Kit?node-id=1-2";
const REVIEW = "/projects/app/builds/b1/diff?snapshot=button-primary";
const ADA = { id: "ada", email: "ada@example.com", name: "Ada", role: "admin" } as const;

afterEach(() => vi.restoreAllMocks());

interface SeedOptions {
  oauth?: boolean;
  user?: typeof ADA | null;
}

async function seed(options: SeedOptions = {}) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const insert = async (table: unknown, row: Record<string, unknown>) =>
    await db.insert(table as never, row as never);
  await insert(db.tables.users, {
    id: "ada",
    email: ADA.email,
    name: "Ada",
    role: "admin",
    createdAt: NOW,
  });
  await insert(db.tables.projects, {
    id: "p1",
    name: "App",
    slug: "app",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "abc1234",
    gitBranch: "main",
    isDefault: true,
    status: "approved",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await insert(db.tables.snapshots, {
    id: "button-primary",
    projectId: "p1",
    buildId: "b1",
    storyId: "button-primary",
    storyName: "Primary",
    storyTitle: "Button",
    storyImportPath: "./src/Button.stories.tsx",
    screenshotPath: "p1/button.png",
    status: "changed",
    baselineVersion: NOW,
    designUrl: NODE_URL,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const figma = createFigmaDesign(
    options.oauth === false ? {} : { oauth: { clientId: "cid", clientSecret: "csecret" } },
  );
  const app = createShelfApp({
    testing: { runner: stubRunner() },
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    design: [figma],
    auth: stubAuth(options.user === undefined ? ADA : options.user),
    config: { secret: SECRET, publicBaseUrl: BASE },
  });
  return {
    app,
    db,
    objects,
    connections: new ConnectionModel(db, SECRET),
    credentials: new DesignCredentialModel(db, SECRET),
  };
}

function figmaApi(handler: (url: string, init?: RequestInit) => Response): void {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url =
      input instanceof Request ? input.url : typeof input === "string" ? input : input.href;
    return url.startsWith("https://api.figma.com/") ? handler(url, init) : await real(input, init);
  });
}

/** Run `/start`, returning the redirect target and the cookie the callback must send back. */
async function start(app: Awaited<ReturnType<typeof seed>>["app"], query = "return=/projects/app") {
  const res = await app.request(`/connections/figma/start?${query}`);
  const cookie = /storyshelf_oauth_state=([^;]+)/u.exec(res.headers.get("set-cookie") ?? "")?.[1];
  const location = new URL(res.headers.get("location") ?? "https://none.test");
  return { res, location, cookie: cookie ?? "", state: location.searchParams.get("state") ?? "" };
}

const callback = (
  app: Awaited<ReturnType<typeof seed>>["app"],
  state: string,
  cookie: string,
  extra = "code=abc",
) =>
  app.request(`/connections/figma/callback?${extra}&state=${encodeURIComponent(state)}`, {
    headers: { cookie: `storyshelf_oauth_state=${cookie}` },
  });

describe("connect flow", () => {
  it("starts at Figma with a signed state and a browser-bound cookie", async () => {
    const { app } = await seed();
    const { res, location, cookie } = await start(app);
    expect(res.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe("https://www.figma.com/oauth");
    expect(location.searchParams.get("client_id")).toBe("cid");
    expect(location.searchParams.get("redirect_uri")).toBe(`${BASE}/connections/figma/callback`);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/iu);
    expect(cookie).not.toBe("");
  });

  it("stores the member's tokens encrypted and returns to the page they came from", async () => {
    const { app, connections } = await seed();
    figmaApi(() =>
      Response.json({ access_token: "figu_at", refresh_token: "rt", expires_in: 3600 }),
    );
    const { state, cookie } = await start(app);
    const res = await callback(app, state, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/projects/app");
    expect(await connections.accessToken("ada", "figma")).toBe("figu_at");
    expect((await connections.info("ada", "figma"))?.tokenEncrypted).not.toContain("figu_at");
  });

  it("never redirects off-site, whatever return value was supplied", async () => {
    const { app } = await seed();
    const { res } = await start(app, "return=https://evil.test");
    const state = new URL(res.headers.get("location") ?? "").searchParams.get("state") ?? "";
    expect(state).not.toBe("");
    figmaApi(() => Response.json({ access_token: "at", expires_in: 60 }));
    const cookie = /storyshelf_oauth_state=([^;]+)/u.exec(res.headers.get("set-cookie") ?? "")?.[1];
    const done = await callback(app, state, cookie ?? "");
    expect(done.headers.get("location")).toBe("/");
  });

  it("refuses a forged state, another browser's cookie, another user's state and a replay", async () => {
    const { app, connections } = await seed();
    const exchange = vi.fn(() => Response.json({ access_token: "at", expires_in: 60 }));
    figmaApi(exchange);
    const { state, cookie } = await start(app);
    expect((await callback(app, `${state}x`, cookie)).status).toBe(403);
    expect((await callback(app, state, "other-browser")).status).toBe(403);
    const bob = signState(SECRET, { userId: "bob", service: "figma", returnTo: "/" });
    expect((await callback(app, bob.state, bob.nonce)).status).toBe(403);
    expect(exchange).not.toHaveBeenCalled();
    expect(await connections.info("ada", "figma")).toBeNull();
    expect((await callback(app, state, cookie)).status).toBe(302);
    expect((await callback(app, state, "")).status).toBe(403);
  });

  it("reports a cancelled consent or failed exchange without connecting", async () => {
    const { app, connections } = await seed();
    const first = await start(app);
    const denied = await callback(app, first.state, first.cookie, "error=access_denied");
    expect(denied.status).toBe(302);
    expect(denied.headers.get("set-cookie")).toContain("cancelled");
    figmaApi(() => new Response("{}", { status: 400 }));
    const second = await start(app);
    const failed = await callback(app, second.state, second.cookie);
    expect(failed.headers.get("set-cookie")).toContain("Could%20not%20connect");
    expect(await connections.info("ada", "figma")).toBeNull();
  });

  it("is unavailable without OAuth configured, for unknown services and when signed out", async () => {
    const plain = await seed({ oauth: false });
    expect((await plain.app.request("/connections/figma/start")).status).toBe(404);
    const { app } = await seed();
    expect((await app.request("/connections/nope/start")).status).toBe(404);
    const anonymous = await seed({ user: null });
    const res = await anonymous.app.request("/connections/figma/start");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login");
  });

  it("disconnects only with a CSRF token", async () => {
    const { app, connections } = await seed();
    await connections.connect("ada", "figma", { accessToken: "at", expiresAt: null });
    const body = new URLSearchParams({ return: "/projects/app" }).toString();
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    const rejected = await app.request("/connections/figma/disconnect", {
      method: "POST",
      headers,
      body,
    });
    expect(rejected.status).toBe(403);
    expect(await connections.info("ada", "figma")).not.toBeNull();
    const ok = await app.request("/connections/figma/disconnect", {
      method: "POST",
      headers: { ...headers, "x-csrf-token": getCsrfToken(SECRET) },
      body,
    });
    expect(ok.status).toBe(303);
    expect(await connections.info("ada", "figma")).toBeNull();
  });
});

describe("design previews with a member connection", () => {
  it("offers to connect when the project has no token, and hides the offer once it does", async () => {
    const { app, credentials } = await seed();
    figmaApi(() => new Response("{}"));
    const offer = await (await app.request(REVIEW)).text();
    expect(offer).toContain("Connect Figma for design previews");
    expect(offer).toContain("/connections/figma/start?return=");
    await credentials.set("p1", "figma", "figd_project");
    expect(await (await app.request(REVIEW)).text()).not.toContain(
      "Connect Figma for design previews",
    );
  });

  it("never offers a connection when the server has no Figma app", async () => {
    const { app } = await seed({ oauth: false });
    expect(await (await app.request(REVIEW)).text()).not.toContain("for design previews");
  });

  it("fetches with the member's own bearer token and shows the design name", async () => {
    const { app, connections } = await seed();
    await connections.connect("ada", "figma", { accessToken: "figu_ada", expiresAt: null });
    const auth: (string | null)[] = [];
    figmaApi((_url, init) => {
      auth.push(new Headers(init?.headers).get("authorization"));
      return Response.json({
        nodes: { "1:2": { document: { name: "Primary button" }, lastModified: NOW, version: "9" } },
        name: "Kit",
        version: "9",
        lastModified: NOW,
      });
    });
    const html = await (await app.request(REVIEW)).text();
    expect(auth[0]).toBe("Bearer figu_ada");
    expect(html).toContain("Previews use your Figma account");
    expect(html).not.toContain("Connect Figma for design previews");
  });

  it("asks to reconnect once a connection expired", async () => {
    const { app, connections } = await seed();
    await connections.connect("ada", "figma", {
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    figmaApi(() => new Response("{}", { status: 400 }));
    const html = await (await app.request(REVIEW)).text();
    expect(html).toContain("Your Figma connection expired");
    expect((await connections.info("ada", "figma"))?.status).toBe("expired");
  });
});

async function withRender(viewerId: string) {
  const { app, db, objects } = await seed();
  objects.set("p1/render.png", Buffer.from([137, 80, 78, 71]));
  await db.insert(db.tables.designNodes, {
    id: "node1",
    projectId: "p1",
    provider: "figma",
    viewerId,
    fileKey: "KEY",
    nodeId: "1:2",
    state: "ok",
    version: "9",
    renderPath: "p1/render.png",
    renderVersion: "9",
    fetchedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  return app;
}

describe("member renders", () => {
  it("serves a render fetched with the member's own connection only to that member", async () => {
    const own = await withRender("ada");
    expect((await own.request("/api/v1/projects/app/design/renders/node1?v=9")).status).toBe(200);
    const foreign = await withRender("bob");
    expect((await foreign.request("/api/v1/projects/app/design/renders/node1?v=9")).status).toBe(
      404,
    );
  });

  it("serves project-wide renders to any member", async () => {
    const app = await withRender("");
    expect((await app.request("/api/v1/projects/app/design/renders/node1?v=9")).status).toBe(200);
  });
});
