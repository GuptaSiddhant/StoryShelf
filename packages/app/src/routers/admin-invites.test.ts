import { createShelfLogger } from "@storyshelf/core/logger";
import { MemberModel } from "@storyshelf/core/models";
import { createTestProject, makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { AuthUser } from "@storyshelf/core/types";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const TOKEN = "inv_secret-token-value";
const issueInvite = vi.fn(async (input: { email: string; name: string; role: string }) => {
  await Promise.resolve();
  return { inviteId: "inv1", token: TOKEN, expiresAt: "2026-12-04T00:00:00.000Z", input };
});

function admin(role: AuthUser["role"]): AuthUser {
  return { id: "u1", email: "a@b.c", name: "A", role };
}

async function seed(role: AuthUser["role"], config: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const logger = pino({ level: "trace" }, { write: (line: string) => lines.push(line) });
  const { storage } = makeStorage();
  const { db } = makeDatabase();
  const app = createShelfApp({
    database: db,
    storage,
    logger: logger as unknown as ReturnType<typeof createShelfLogger>,
    config: { secret: "invite-test-secret", adminToken: "adm", ...config },
    auth: stubAuth(admin(role), { issueInvite }),
  });
  await app.lifecycle.setup();
  return { app, lines, db };
}

async function csrf(app: Awaited<ReturnType<typeof seed>>["app"]): Promise<string> {
  const html = await (await app.request("/admin/invites/new")).text();
  return /name="csrf-token" content="([^"]+)"/u.exec(html)?.[1] ?? "";
}

function post(app: Awaited<ReturnType<typeof seed>>["app"], token: string, email: string) {
  return app.request("/admin/invites", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf_token: token, email, name: "", role: "member" }).toString(),
  });
}

describe("site admin invites", () => {
  it("shows the one-time link once, no-store, and never logs it", async () => {
    const { app, lines } = await seed("admin");
    const response = await post(app, await csrf(app), "Ana@Example.com");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain(`/auth/invites/inv1?token=${TOKEN}`);
    expect(issueInvite).toHaveBeenLastCalledWith({
      email: "ana@example.com",
      name: "ana",
      role: "member",
    });
    expect(lines.join("")).not.toContain(TOKEN);
    // Asking for the form again shows no link.
    expect(await (await app.request("/admin/invites/new")).text()).not.toContain(TOKEN);
  });

  it("uses a confirmed public origin for an absolute link, never the Host", async () => {
    const { app } = await seed("admin", { publicBaseUrl: "https://shelf.example.com" });
    const response = await app.request("/api/v1/admin/invites", {
      method: "POST",
      headers: {
        authorization: "Bearer adm",
        "content-type": "application/json",
        host: "evil.test",
      },
      body: JSON.stringify({ email: "a@b.co" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { link: string; absolute: boolean };
    expect(body.absolute).toBe(true);
    expect(body.link).toBe(`https://shelf.example.com/auth/invites/inv1?token=${TOKEN}`);
  });

  it("answers a non-admin 403 the same for any email, and issues nothing", async () => {
    issueInvite.mockClear();
    const { app } = await seed("member");
    const form = (email: string) =>
      app.request("/admin/invites", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email }).toString(),
      });
    const known = await form("a@b.c");
    const unknown = await form("nobody@example.com");
    expect(known.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(await known.text()).toBe(await unknown.text());
    expect((await app.request("/admin/invites/new")).status).toBe(403);
    const api = await app.request("/api/v1/admin/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.c" }),
    });
    expect(api.status).toBe(403);
    expect(issueInvite).not.toHaveBeenCalled();
  });

  it("refuses a form post without a CSRF token", async () => {
    const { app } = await seed("admin");
    const response = await post(app, "", "ana@example.com");
    expect(response.status).toBe(403);
  });

  it("re-renders the form with a reason for a bad email", async () => {
    const { app } = await seed("admin");
    const response = await post(app, await csrf(app), "not-an-email");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Enter a valid email");
  });
});

describe("Add member offers an invite", () => {
  async function refusal(role: AuthUser["role"]): Promise<string> {
    const { app, db } = await seed(role);
    const project = await createTestProject(db, db.tables);
    await new MemberModel(db).set(project.id, "u1", "admin");
    const page = await (await app.request(`/projects/${project.slug}/settings/access`)).text();
    const token = /name="csrf-token" content="([^"]+)"/u.exec(page)?.[1] ?? "";
    const response = await app.request(`/projects/${project.slug}/settings/members`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrf_token: token,
        email: "new@example.com",
        role: "viewer",
      }).toString(),
    });
    expect(response.status).toBe(400);
    return await response.text();
  }

  it("links a site admin to the invite form for that address", async () => {
    expect(await refusal("admin")).toContain("/admin/invites/new?email=new%40example.com");
  });

  it("offers a project admin who is not a site admin nothing", async () => {
    expect(await refusal("member")).not.toContain("/admin/invites/new");
  });
});
