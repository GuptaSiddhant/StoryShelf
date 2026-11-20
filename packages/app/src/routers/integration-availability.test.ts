import { NotificationChannelModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";

/**
 * Issue #1126: on a server with no email sender (the built-in `email` notifier is unavailable),
 * projects are not offered email, an existing email channel is hidden and kept, creating one is
 * refused with the reason, and site admins see what is missing.
 */
const secret = "test-secret";
const projectAdmin = { id: "u_pa", email: "pa@example.com", name: "PA", role: "member" as const };
const siteAdmin = { id: "u_sa", email: "sa@example.com", name: "SA", role: "admin" as const };
const users = { pa: projectAdmin, sa: siteAdmin };

const auth = stubAuth(null, {
  check: async (request: Request) => {
    const match = /storyshelf_session=(pa|sa)/u.exec(request.headers.get("cookie") ?? "");
    return match?.[1] === "pa" || match?.[1] === "sa" ? users[match[1]] : null;
  },
});

async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Notify Project",
    slug: "notify-project",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  await Promise.all(
    [projectAdmin, siteAdmin].map(
      async (user) =>
        await db.insert(db.tables.users, {
          ...user,
          avatarUrl: null,
          lastLoginAt: null,
          createdAt: now,
          passwordHash: null,
          displayNameOverride: null,
          authProvider: "local",
          disabled: false,
        }),
    ),
  );
  await db.insert(db.tables.projectMembers, {
    id: "m1",
    projectId: "p1",
    userId: projectAdmin.id,
    role: "admin",
    source: "manual",
    createdAt: now,
  });
  const channels = new NotificationChannelModel(db, undefined, secret);
  const email = await channels.create({
    projectId: "p1",
    provider: "email",
    config: { to: "team@example.com" },
  });
  await channels.create({ projectId: "p1", provider: "log", config: { style: "compact" } });
  const app = createShelfApp({
    database: db,
    storage,
    auth,
    logger: pino({ level: "silent" }),
    config: { secret },
  });
  return { db, app, emailId: email.id };
}

const as = (who: "pa" | "sa", init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: {
    cookie: `storyshelf_session=${who}`,
    "sec-fetch-site": "same-origin",
    "x-csrf-token": getCsrfToken(secret, who),
    ...(init.headers as Record<string, string> | undefined),
  },
});

const SETTINGS = "/projects/notify-project/settings/review";
const API = "/api/v1/projects/notify-project/notification-channels";

describe("integrations the server cannot deliver (#1126)", () => {
  it("hides email from a project admin, with no placeholder, and keeps the channel", async () => {
    const { db, app, emailId } = await seed();
    const html = await (await app.request(SETTINGS, as("pa"))).text();
    expect(html).toContain("Add a message channel");
    expect(html).not.toContain(`channel-${emailId}`);
    expect(html).not.toContain('value="email"');
    expect(html).not.toContain("not offered to projects");
    // The personal card sends by email, so it goes with it.
    expect(html).not.toContain("My notifications for this project");
    expect(await new NotificationChannelModel(db).list("p1")).toHaveLength(2);
  });

  it("tells a site admin in one line what is missing, linking to System", async () => {
    const { app } = await seed();
    const html = await (await app.request(SETTINGS, as("sa"))).text();
    expect(html).toContain("Some integrations are not offered to projects on this server");
    expect(html).toContain("Email (Email has no transport");
    expect(html).toContain('href="/admin#integrations"');
  });

  it("refuses to create a channel of the kind, with the reason, in the API and the form", async () => {
    const { app } = await seed();
    const api = await app.request(
      API,
      as("pa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "email", config: { to: "x@example.com" } }),
      }),
    );
    expect(api.status).toBe(400);
    expect(JSON.stringify(await api.json())).toContain("Email is not available on this server");
    const form = await app.request(
      "/projects/notify-project/settings/notifications",
      as("pa", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ provider: "email", target: "x@example.com" }).toString(),
      }),
    );
    expect(form.status).toBe(400);
    expect(await form.text()).toContain("Email is not available on this server");
  });

  it("leaves the hidden channel out of the API listing", async () => {
    const { app } = await seed();
    const rows = (await (await app.request(API, as("pa"))).json()) as { provider: string }[];
    expect(rows.map((row) => row.provider)).toEqual(["log"]);
  });

  it("lists every integration and the channel not delivered to on the System page", async () => {
    const { app } = await seed();
    const html = await (await app.request("/admin", as("sa"))).text();
    expect(html).toContain('id="integrations"');
    expect(html).toContain("Unavailable");
    expect(html).toContain("Email has no transport");
    expect(html).toContain("Channels not delivered to");
    expect(html).toContain("Notify Project");
    expect(html).toContain("/projects/notify-project/settings/review");
  });
});
