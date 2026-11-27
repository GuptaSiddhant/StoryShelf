import {
  GIT_LINK_ANY_REPOSITORY_KEY,
  GitConnectionModel,
  GitRepositoryLinkModel,
  SiteSettingsModel,
} from "@storyshelf/core/models";
import { createTestProject, makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { generateKeyPairSync } from "node:crypto";
import { Writable } from "node:stream";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const SECRET = "git-admin-test-secret-0123456789abcdef";
const ORIGIN = "https://shelf.example.com";
const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
  type: "pkcs8",
  format: "pem",
});
const GITLAB_TOKEN = "glpat-supersecrettokenvalue";

afterEach(() => {
  vi.restoreAllMocks();
});

type Role = "admin" | "member";

/** An app with a signed-in user, and every log line it writes. */
async function seedApp(options: { role?: Role; origin?: boolean } = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const user = { id: "u1", email: "a@example.com", name: "Ada", role: options.role ?? "admin" };
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "debug" }, stream),
    auth: stubAuth(user),
    config: { secret: SECRET, ...(options.origin === false ? {} : { publicBaseUrl: ORIGIN }) },
  });
  await app.lifecycle.setup();
  return { app, db, lines };
}

type Seeded = Awaited<ReturnType<typeof seedApp>>;

const cookieOf = (id: string): string => `storyshelf_session=${id}`;

/** A browser session: its cookie, and the CSRF token its pages carry. */
async function openSession(seeded: Seeded, id = "session-a") {
  const html = await (
    await seeded.app.request("/admin/git", { headers: { cookie: cookieOf(id) } })
  ).text();
  const token = /name="csrf-token" content="(?<token>[^"]+)"/u.exec(html)?.groups?.["token"] ?? "";
  const post = async (path: string, fields: Record<string, string>) =>
    await seeded.app.request(path, {
      method: "POST",
      headers: {
        cookie: cookieOf(id),
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
        "x-csrf-token": token,
      },
      body: new URLSearchParams(fields).toString(),
    });
  const get = async (path: string, headers: Record<string, string> = {}) =>
    await seeded.app.request(path, { headers: { cookie: cookieOf(id), ...headers } });
  return { post, get };
}

/** Answer the git host's API the way a stub host would; anything else fails the test. */
function stubHost(answers: Record<string, unknown>): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const key = Object.keys(answers).find((path) => url.includes(path));
    if (key === undefined) {
      throw new Error(`unexpected request to ${url}`);
    }
    return Response.json(answers[key]);
  });
}

describe("System → Git", () => {
  it("is for site admins only", async () => {
    const seeded = await seedApp({ role: "member" });
    expect((await seeded.app.request("/admin/git")).status).toBe(403);
    expect((await seeded.app.request("/admin/git/connections/new")).status).toBe(403);
  });

  it("lists no connections, then a stored App without its key", async () => {
    const seeded = await seedApp();
    const browser = await openSession(seeded);
    expect(await (await browser.get("/admin/git")).text()).toContain("No git connections");
    const created = await browser.post("/admin/git/connections", {
      kind: "github-app",
      app_name: "Acme App",
      app_id: "12345",
      app_key: PEM,
      app_comment: "on",
    });
    expect(created.status).toBe(302);
    const [connection] = await new GitConnectionModel(seeded.db, SECRET).list();
    expect(connection).toMatchObject({ name: "Acme App", provider: "github-app" });
    expect(connection?.config).toMatchObject({ appId: "12345", posts: { pullRequests: true } });
    stubHost({ "/app": { slug: "acme-app" } });
    const html = await (await browser.get("/admin/git")).text();
    expect(html).toContain("Acme App");
    expect(html).toContain("App acme-app");
    expect(html).not.toContain("PRIVATE KEY");
    expect(seeded.lines.join("")).not.toContain("PRIVATE KEY");
  });

  it("re-renders the form with an error, and never echoes the key", async () => {
    const seeded = await seedApp();
    const browser = await openSession(seeded);
    const refused = await browser.post("/admin/git/connections", {
      kind: "github-app",
      app_id: "12345",
      app_key: "-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----",
    });
    expect(refused.status).toBe(422);
    const html = await refused.text();
    expect(html).toContain("Paste the App&#39;s PEM private key");
    expect(html).not.toContain("not a key");
  });

  it("refuses a field of another option", async () => {
    const seeded = await seedApp();
    const browser = await openSession(seeded);
    const refused = await browser.post("/admin/git/connections", {
      kind: "gitlab-token",
      app_id: "1",
    });
    expect(refused.status).toBe(422);
    expect(await new GitConnectionModel(seeded.db, SECRET).list()).toEqual([]);
  });

  it("prepares GitLab's form, then stores the token with its expiry and ceiling", async () => {
    const seeded = await seedApp();
    const browser = await openSession(seeded);
    const prepared = await browser.post("/admin/git/connections", {
      kind: "gitlab-token",
      intent: "prepare",
      gl_host: "https://gitlab.example.com",
      gl_group: "acme/web",
    });
    expect(prepared.status).toBe(200);
    expect(await prepared.text()).toContain(
      "https://gitlab.example.com/groups/acme/web/-/settings/access_tokens?name=StoryShelf&amp;scopes=api",
    );
    const stored = await browser.post("/admin/git/connections", {
      kind: "gitlab-token",
      gl_host: "https://gitlab.example.com",
      gl_group: "acme/web",
      gl_name: "Acme GitLab",
      gl_token: GITLAB_TOKEN,
      gl_expires: "2099-01-31",
    });
    expect(stored.status).toBe(302);
    const [connection] = await new GitConnectionModel(seeded.db, SECRET).list();
    expect(connection).toMatchObject({
      provider: "gitlab-token",
      apiBase: "https://gitlab.example.com",
    });
    expect(connection?.config).toMatchObject({
      expiresOn: "2099-01-31",
      group: "acme/web",
      posts: { pullRequests: false },
    });
    stubHost({ "/personal_access_tokens/self": { active: true } });
    const html = await (await browser.get("/admin/git")).text();
    expect(html).toContain("acme/web on gitlab.example.com");
    expect(html).toContain("Token expires Jan 31, 2099");
    expect(html).not.toContain(GITLAB_TOKEN);
  });

  it("refuses a write without a CSRF token", async () => {
    const seeded = await seedApp();
    const refused = await seeded.app.request("/admin/git/settings", {
      method: "POST",
      headers: {
        cookie: cookieOf("session-a"),
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "anyRepository=on",
    });
    expect(refused.status).toBe(403);
  });

  it("saves the operator switch", async () => {
    const seeded = await seedApp();
    const browser = await openSession(seeded);
    await browser.post("/admin/git/settings", { anyRepository: "on" });
    const settings = new SiteSettingsModel(seeded.db);
    expect(await settings.get(GIT_LINK_ANY_REPOSITORY_KEY)).toBe("true");
    await browser.post("/admin/git/settings", {});
    expect(await settings.get(GIT_LINK_ANY_REPOSITORY_KEY)).toBe("false");
  });
});

/** Start Connect GitHub; answers the state GitHub would carry back. */
async function startManifest(browser: Awaited<ReturnType<typeof openSession>>): Promise<string> {
  const started = await browser.post("/admin/git/connections", {
    kind: "github-manifest",
    gh_name: "Acme Shelf",
    gh_org: "acme",
    gh_comment: "on",
  });
  expect(started.status).toBe(200);
  const html = await started.text();
  const action =
    /<form method="post" action="(?<action>[^"]+)"/u.exec(html)?.groups?.["action"] ?? "";
  const url = new URL(action.replaceAll("&amp;", "&"));
  expect(`${url.origin}${url.pathname}`).toBe(
    "https://github.com/organizations/acme/settings/apps/new",
  );
  const manifest =
    /name="manifest" value="(?<manifest>[^"]+)"/u.exec(html)?.groups?.["manifest"] ?? "";
  expect(JSON.parse(manifest.replaceAll("&quot;", '"'))).toMatchObject({
    name: "Acme Shelf",
    redirect_url: `${ORIGIN}/admin/git/github/return`,
    hook_attributes: { active: false },
    default_permissions: { checks: "write", contents: "read", pull_requests: "write" },
  });
  return url.searchParams.get("state") ?? "";
}

describe("Connect GitHub (the manifest flow)", () => {
  it("refuses to start without a confirmed public origin", async () => {
    const seeded = await seedApp({ origin: false });
    const browser = await openSession(seeded);
    const refused = await browser.post("/admin/git/connections", { kind: "github-manifest" });
    expect(refused.status).toBe(422);
    expect(await refused.text()).toContain("Confirm the server&#39;s public origin first");
  });

  it("confirms on the return page, then exchanges the code once", async () => {
    const seeded = await seedApp();
    const browser = await openSession(seeded);
    const state = await startManifest(browser);
    const back = await browser.get(`/admin/git/github/return?code=one-time-code&state=${state}`);
    expect(back.status).toBe(200);
    expect(back.headers.get("cache-control")).toBe("no-store");
    expect(back.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await new GitConnectionModel(seeded.db, SECRET).list()).toEqual([]);
    const exchange = stubHost({
      "/app-manifests/one-time-code/conversions": {
        id: 777,
        slug: "acme-shelf",
        name: "Acme Shelf",
        owner: { login: "acme" },
        html_url: "https://github.com/apps/acme-shelf",
        pem: PEM,
        webhook_secret: "dropped",
        client_id: "dropped",
        client_secret: "dropped",
      },
    });
    const confirmed = await browser.post("/admin/git/github/confirm", {
      state,
      code: "one-time-code",
    });
    expect(confirmed.status).toBe(302);
    expect(exchange).toHaveBeenCalledTimes(1);
    const [connection] = await new GitConnectionModel(seeded.db, SECRET).list();
    expect(connection?.config).toMatchObject({
      appId: "777",
      owner: "acme",
      htmlUrl: "https://github.com/apps/acme-shelf",
    });
    expect(JSON.stringify(connection)).not.toContain("dropped");
    const again = await browser.post("/admin/git/github/confirm", { state, code: "one-time-code" });
    expect(again.status).toBe(400);
    expect(exchange).toHaveBeenCalledTimes(1);
    const logs = seeded.lines.join("");
    expect(logs).not.toContain("one-time-code");
    expect(logs).not.toContain(state);
  });

  it("does not finish another session's flow", async () => {
    const seeded = await seedApp();
    const state = await startManifest(await openSession(seeded, "session-a"));
    const other = await openSession(seeded, "session-b");
    expect((await other.get(`/admin/git/github/return?code=c&state=${state}`)).status).toBe(400);
    expect((await other.post("/admin/git/github/confirm", { state, code: "c" })).status).toBe(400);
  });

  it("says why when GitHub comes back without a code, or the exchange fails", async () => {
    const seeded = await seedApp();
    const browser = await openSession(seeded);
    const state = await startManifest(browser);
    expect((await browser.get(`/admin/git/github/return?state=${state}`)).status).toBe(400);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("gone", { status: 404 }));
    const failed = await browser.post("/admin/git/github/confirm", { state, code: "expired-code" });
    expect(failed.status).toBe(502);
    expect(await failed.text()).toContain("HTTP 404");
    expect(seeded.lines.join("")).not.toContain("expired-code");
  });
});

/** A project with a pending link to `acme/web` through a GitLab connection, and a session. */
async function seedLink() {
  const seeded = await seedApp();
  const project = await createTestProject(seeded.db, seeded.db.tables, { name: "Web" });
  const connection = await new GitConnectionModel(seeded.db, SECRET).create({
    provider: "gitlab-token",
    name: "Acme GitLab",
    apiBase: "https://gitlab.example.com",
    config: { expiresOn: "2099-01-31" },
    secret: GITLAB_TOKEN,
  });
  const link = await new GitRepositoryLinkModel(seeded.db).create({
    projectId: project.id,
    connectionId: connection.id,
    host: "gitlab.example.com",
    owner: "acme",
    repo: "web",
  });
  return { ...seeded, link, browser: await openSession(seeded) };
}

describe("repository link requests", () => {
  it("lists a pending link with a count, and shows its coverage in the dialog", async () => {
    const { browser, link } = await seedLink();
    stubHost({
      "/personal_access_tokens/self": { active: true },
      "/api/v4/projects/": { id: 4242 },
    });
    const page = await (await browser.get("/admin/git")).text();
    expect(page).toContain("acme/web");
    expect(page).toContain("For Web");
    const dialog = await browser.get(`/admin/git/links/${link.id}/approve`, {
      "HX-Request": "true",
      "HX-Target": "git-link-body",
    });
    const body = await dialog.text();
    expect(body).not.toContain("<!DOCTYPE");
    expect(body).toContain("id 4242");
  });

  it("approves a covered link and pins the repository id", async () => {
    const { browser, link, db } = await seedLink();
    stubHost({ "/api/v4/projects/": { id: 4242 } });
    expect(
      (await browser.post(`/admin/git/links/${link.id}/approve`, { updatedAt: link.updatedAt }))
        .status,
    ).toBe(302);
    expect(await new GitRepositoryLinkModel(db).get(link.id)).toMatchObject({
      state: "approved",
      hostRepositoryId: "4242",
      approvedBy: "u1",
    });
    expect((await browser.get(`/admin/git/links/${link.id}/approve`)).status).toBe(404);
  });

  it("approves nothing when the link was edited after the dialog was rendered", async () => {
    const { browser, link, db } = await seedLink();
    stubHost({ "/api/v4/projects/": { id: 4242 } });
    const links = new GitRepositoryLinkModel(db);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 5000 });
    await links.change(link.id, { repo: "payments" });
    vi.useRealTimers();
    const moved = await browser.post(`/admin/git/links/${link.id}/approve`, {
      updatedAt: link.updatedAt,
    });
    expect(moved.status).toBe(302);
    expect(await links.get(link.id)).toMatchObject({ state: "pending", repo: "payments" });
    const missing = await browser.post(`/admin/git/links/${link.id}/approve`, {});
    expect(missing.status).toBe(302);
    expect((await links.get(link.id))?.state).toBe("pending");
  });

  it("carries the row's updatedAt in the approve dialog", async () => {
    const { browser, link } = await seedLink();
    stubHost({ "/api/v4/projects/": { id: 4242 } });
    const body = await (await browser.get(`/admin/git/links/${link.id}/approve`)).text();
    expect(body).toContain(`name="updatedAt" value="${link.updatedAt}"`);
  });

  it("keeps a link the connection does not cover pending", async () => {
    const { browser, link, db } = await seedLink();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 404 }));
    const refused = await browser.post(`/admin/git/links/${link.id}/approve`, {
      updatedAt: link.updatedAt,
    });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("Not covered");
    expect((await new GitRepositoryLinkModel(db).get(link.id))?.state).toBe("pending");
  });

  it("refuses a link with a reason", async () => {
    const { browser, link, db } = await seedLink();
    const dialog = await browser.get(`/admin/git/links/${link.id}/refuse`);
    expect(await dialog.text()).toContain("<!DOCTYPE");
    expect(
      (await browser.post(`/admin/git/links/${link.id}/refuse`, { reason: "Not ours" })).status,
    ).toBe(302);
    expect(await new GitRepositoryLinkModel(db).get(link.id)).toMatchObject({
      state: "refused",
      reason: "Not ours",
    });
  });

  it("breaks the approved links of a removed connection", async () => {
    const { browser, link, db } = await seedLink();
    const links = new GitRepositoryLinkModel(db);
    await links.approve(link.id, { hostRepositoryId: "4242" }, "u1");
    const removed = await browser.post(`/admin/git/connections/${link.connectionId}/remove`, {});
    expect(removed.status).toBe(302);
    expect(await links.get(link.id)).toMatchObject({ state: "broken" });
    expect(await new GitConnectionModel(db, SECRET).list()).toEqual([]);
  });
});
