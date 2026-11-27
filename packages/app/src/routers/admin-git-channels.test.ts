import {
  GitConnectionModel,
  GitRepositoryLinkModel,
  NotificationChannelModel,
} from "@storyshelf/core/models";
import { createTestProject, makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { generateKeyPairSync } from "node:crypto";
import { Writable } from "node:stream";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const SECRET = "git-channels-test-secret-0123456789abcdef";
const CHANNEL_TOKEN = "glpat-channeltokenvalue";
const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
  type: "pkcs8",
  format: "pem",
});
const DIALOG = { "HX-Request": "true", "HX-Target": "git-channel-body" };

afterEach(() => {
  vi.restoreAllMocks();
});

/** An app with a site admin (or a member), a project, a GitLab channel and every log line. */
async function seedApp(options: { role?: "admin" | "member"; connection?: boolean } = {}) {
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
    config: { secret: SECRET, publicBaseUrl: "https://shelf.example.com" },
  });
  await app.lifecycle.setup();
  const project = await createTestProject(db, db.tables, { name: "Web" });
  const channels = new NotificationChannelModel(db, undefined, SECRET);
  const channel = await channels.create({
    projectId: project.id,
    provider: "gitlab",
    config: { owner: "Acme", repo: "Web", host: "https://gitlab.example.com", prefix: "web" },
    secret: CHANNEL_TOKEN,
  });
  const connection =
    options.connection === false
      ? null
      : await new GitConnectionModel(db, SECRET).create({
          provider: "gitlab-token",
          name: "Acme GitLab",
          apiBase: "https://gitlab.example.com",
          config: { expiresOn: "2099-01-31" },
          secret: "glpat-connectiontoken",
        });
  return { app, db, lines, project, channels, channel, connection };
}

type Seeded = Awaited<ReturnType<typeof seedApp>>;

/** A browser session: GET and CSRF-protected POST. */
async function openSession(seeded: Seeded) {
  const cookie = "storyshelf_session=session-a";
  const html = await (await seeded.app.request("/admin/git", { headers: { cookie } })).text();
  const token = /name="csrf-token" content="(?<token>[^"]+)"/u.exec(html)?.groups?.["token"] ?? "";
  return {
    get: async (path: string, headers: Record<string, string> = {}) =>
      await seeded.app.request(path, { headers: { cookie, ...headers } }),
    post: async (path: string, fields: Record<string, string>) =>
      await seeded.app.request(path, {
        method: "POST",
        headers: {
          cookie,
          "sec-fetch-site": "same-origin",
          "content-type": "application/x-www-form-urlencoded",
          "x-csrf-token": token,
        },
        body: new URLSearchParams(fields).toString(),
      }),
  };
}

/** GitLab answers every project read with `status` (the probe and the coverage check alike). */
function gitlabAnswers(status: number): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/personal_access_tokens/self")) {
      return Response.json({ active: true });
    }
    return status === 200
      ? Response.json({ id: 4242 })
      : new Response("{}", { status, headers: { "content-type": "application/json" } });
  });
}

describe("System › Git per-project channels", () => {
  it("are for site admins only", async () => {
    const seeded = await seedApp({ role: "member" });
    expect((await seeded.app.request(`/admin/git/channels/${seeded.channel.id}/move`)).status).toBe(
      403,
    );
  });

  it("lists each channel with the release it stops in, never its token", async () => {
    const seeded = await seedApp();
    gitlabAnswers(200);
    const browser = await openSession(seeded);
    const page = await (await browser.get("/admin/git")).text();
    expect(page).toContain("Per-project channels");
    expect(page).toContain("acme/web");
    expect(page).toContain("1 per-project git channel stop posting in 0.19.0");
    expect(page).not.toContain(CHANNEL_TOKEN);
    const system = await (await browser.get("/admin")).text();
    expect(system).toContain("stop posting in 0.19.0");
    expect(system).toContain('href="/admin/git"');
  });

  it("offers the fitting connection in the dialog, as a fragment or a page", async () => {
    const seeded = await seedApp();
    const browser = await openSession(seeded);
    const path = `/admin/git/channels/${seeded.channel.id}/move`;
    const fragment = await (await browser.get(path, DIALOG)).text();
    expect(fragment).not.toContain("<!DOCTYPE");
    expect(fragment).toContain("Acme GitLab");
    expect(fragment).toContain(`value="${seeded.channel.updatedAt}"`);
    expect(await (await browser.get(path)).text()).toContain("<!DOCTYPE");
    expect((await browser.get("/admin/git/channels/missing/move")).status).toBe(404);
  });

  it("asks for a connection first when none fits", async () => {
    const seeded = await seedApp({ connection: false });
    const browser = await openSession(seeded);
    const body = await (
      await browser.get(`/admin/git/channels/${seeded.channel.id}/move`, DIALOG)
    ).text();
    expect(body).toContain("Add a connection first");
    expect(body).toContain("/admin/git/connections/new?kind=gitlab-token");
  });

  it("moves a covered channel: an approved link with the same prefix, and the channel is gone", async () => {
    const seeded = await seedApp();
    gitlabAnswers(200);
    const browser = await openSession(seeded);
    const moved = await browser.post(`/admin/git/channels/${seeded.channel.id}/move`, {
      connection: seeded.connection?.id ?? "",
      updatedAt: seeded.channel.updatedAt,
    });
    expect(moved.status).toBe(302);
    expect(await seeded.channels.get(seeded.channel.id)).toBeNull();
    const [link] = await new GitRepositoryLinkModel(seeded.db).list(seeded.project.id);
    expect(link).toMatchObject({
      connectionId: seeded.connection?.id,
      host: "gitlab.example.com",
      owner: "acme",
      repo: "web",
      prefix: "web",
      state: "approved",
      hostRepositoryId: "4242",
      approvedBy: "u1",
    });
    expect(seeded.lines.join("")).not.toContain(CHANNEL_TOKEN);
  });

  it("leaves the channel unchanged when the connection does not cover the repository", async () => {
    const seeded = await seedApp();
    gitlabAnswers(404);
    const browser = await openSession(seeded);
    const refused = await browser.post(`/admin/git/channels/${seeded.channel.id}/move`, {
      connection: seeded.connection?.id ?? "",
      updatedAt: seeded.channel.updatedAt,
    });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("Not covered");
    expect(await seeded.channels.get(seeded.channel.id)).not.toBeNull();
    expect(await new GitRepositoryLinkModel(seeded.db).listAll()).toHaveLength(0);
  });

  it("names the status of an inconclusive host, and changes nothing", async () => {
    const seeded = await seedApp();
    gitlabAnswers(502);
    const browser = await openSession(seeded);
    const failed = await browser.post(`/admin/git/channels/${seeded.channel.id}/move`, {
      connection: seeded.connection?.id ?? "",
      updatedAt: seeded.channel.updatedAt,
    });
    expect(failed.status).toBe(409);
    const body = await failed.text();
    expect(body).toContain("HTTP 502");
    expect(body).not.toContain(CHANNEL_TOKEN);
    expect(await seeded.channels.get(seeded.channel.id)).not.toBeNull();
  });

  it("moves nothing for a stale page, a missing choice or a connection that does not fit", async () => {
    const seeded = await seedApp();
    const browser = await openSession(seeded);
    const path = `/admin/git/channels/${seeded.channel.id}/move`;
    const stale = await browser.post(path, {
      connection: seeded.connection?.id ?? "",
      updatedAt: "earlier",
    });
    expect(stale.status).toBe(302);
    expect((await browser.post(path, { updatedAt: seeded.channel.updatedAt })).status).toBe(422);
    const unfit = await browser.post(path, {
      connection: "from-channel",
      updatedAt: seeded.channel.updatedAt,
    });
    expect(unfit.status).toBe(409);
    expect(await seeded.channels.get(seeded.channel.id)).not.toBeNull();
  });

  it("makes a GitHub App channel's own App the connection, keeping the key out of every answer", async () => {
    const seeded = await seedApp({ connection: false });
    const app = await seeded.channels.create({
      projectId: seeded.project.id,
      provider: "github",
      config: { owner: "acme", repo: "docs", mode: "checks", appId: "777", installationId: "1" },
      secret: PEM,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.endsWith("/installation")
        ? Response.json({ id: 1 })
        : Response.json(
            { token: "t", repositories: [{ id: 99, full_name: "acme/docs" }] },
            { status: 201 },
          );
    });
    const browser = await openSession(seeded);
    const dialog = await (await browser.get(`/admin/git/channels/${app.id}/move`, DIALOG)).text();
    expect(dialog).toContain("New connection from this channel");
    const moved = await browser.post(`/admin/git/channels/${app.id}/move`, {
      connection: "from-channel",
      updatedAt: app.updatedAt,
    });
    expect(moved.status).toBe(302);
    const [connection] = await new GitConnectionModel(seeded.db, SECRET).list();
    expect(connection).toMatchObject({ provider: "github-app", name: "GitHub App 777" });
    const page = await (await browser.get("/admin/git")).text();
    expect(page).not.toContain("PRIVATE KEY");
    expect(seeded.lines.join("")).not.toContain("PRIVATE KEY");
  });
});
