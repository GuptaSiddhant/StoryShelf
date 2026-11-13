import { NotificationSubscriptionModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { getCsrfToken } from "../middleware/csrf.ts";
import { stubAuth } from "../stub-auth.ts";

const silentLogger = pino({ level: "silent" });
const secret = "test-secret";

const accountUser = {
  id: "user_1",
  email: "ada@example.com",
  name: "Ada",
  role: "member" as const,
  providerId: "account",
};

const accountAuth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    return cookie.includes("storyshelf_session=ok") ? accountUser : null;
  },
});

async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(db.tables.users, {
    id: accountUser.id,
    email: accountUser.email,
    name: accountUser.name,
    avatarUrl: null,
    role: accountUser.role,
    lastLoginAt: now,
    createdAt: now,
    passwordHash: null,
    displayNameOverride: null,
    authProvider: "local",
    disabled: false,
  });
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Demo",
    slug: "demo",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(db.tables.projectMembers, {
    id: "m1",
    projectId: "p1",
    userId: accountUser.id,
    role: "viewer",
    source: "manual",
    createdAt: now,
  });
  return { db, storage };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

function testApp(seeded: Seeded): ReturnType<typeof createShelfApp> {
  return createShelfApp({
    database: seeded.db,
    storage: seeded.storage,
    auth: accountAuth,
    logger: silentLogger,
    config: { secret },
  });
}

function postForm(path: string, form: FormData, app: ReturnType<typeof createShelfApp>) {
  return app.request(path, {
    method: "POST",
    headers: {
      cookie: "storyshelf_session=ok",
      "sec-fetch-site": "same-origin",
      "x-csrf-token": getCsrfToken(secret, "ok"),
    },
    body: form,
  });
}

const session = { cookie: "storyshelf_session=ok", "sec-fetch-site": "same-origin" };

describe("profile page", () => {
  it("redirects anonymous users to login", async () => {
    const response = await testApp(await seed()).request("/profile");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/login");
  });

  it("renders the user, provider, and memberships", async () => {
    const response = await testApp(await seed()).request("/profile", { headers: session });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Ada");
    expect(html).toContain("via local");
    expect(html).toContain("Demo");
  });

  it("refuses non-https avatar URLs", async () => {
    const seeded = await seed();
    const evil = { ...accountUser, avatarUrl: "javascript:alert(1)" };
    const app = createShelfApp({
      database: seeded.db,
      storage: seeded.storage,
      auth: stubAuth(null, {
        check: async (request: Request) => {
          const cookie = request.headers.get("cookie") ?? "";
          return cookie.includes("storyshelf_session=ok") ? evil : null;
        },
      }),
      logger: silentLogger,
      config: { secret },
    });
    const html = await (await app.request("/profile", { headers: session })).text();
    expect(html).not.toContain("javascript:");
    expect(html).toContain("A</span>");
  });

  it("updates the display name override", async () => {
    const seeded = await seed();
    const app = testApp(seeded);
    const form = new FormData();
    form.set("displayName", "Ada L");
    const post = await postForm("/profile", form, app);
    expect(post.status).not.toBe(400);
    const page = await app.request("/profile", { headers: session });
    expect(await page.text()).toContain("Ada L");
  });

  it("rejects an empty display name", async () => {
    const form = new FormData();
    form.set("displayName", "  ");
    const response = await postForm("/profile", form, testApp(await seed()));
    expect(response.status).toBe(400);
  });

  it("toggles project email notifications from the profile page", async () => {
    const seeded = await seed();
    const app = testApp(seeded);
    const page = await app.request("/profile", { headers: session });
    expect(await page.text()).toContain("Notifications");

    const enable = new FormData();
    enable.set("slug", "demo");
    enable.set("enabled", "1");
    const saved = await postForm("/profile/notifications", enable, app);
    expect(saved.status).not.toBe(400);
    const enabled = await app.request("/profile", { headers: session });
    expect(await enabled.text()).toContain("Email on");

    const disable = new FormData();
    disable.set("slug", "demo");
    const removed = await postForm("/profile/notifications", disable, app);
    expect(removed.status).not.toBe(400);
    const off = await app.request("/profile", { headers: session });
    expect(await off.text()).not.toContain("Email on");
  });

  it("keeps the subscription, switched off, when email is disabled from the profile page", async () => {
    const seeded = await seed();
    const app = testApp(seeded);
    const projects = await seeded.db.list(seeded.db.tables.projects, { limit: 1 });
    const projectId = (projects[0] as { id: string }).id;
    const userId = (await seeded.db.list(seeded.db.tables.users, { limit: 1 }))[0]?.[
      "id"
    ] as string;
    const model = new NotificationSubscriptionModel(seeded.db);
    await model.upsert(projectId, userId, { events: ["build:approved"], via: ["email"] });

    const disable = new FormData();
    disable.set("slug", "demo");
    await postForm("/profile/notifications", disable, app);
    expect(await model.getFor(projectId, userId)).toMatchObject({
      enabled: false,
      events: '["build:approved"]',
    });

    const enable = new FormData();
    enable.set("slug", "demo");
    enable.set("enabled", "1");
    await postForm("/profile/notifications", enable, app);
    expect(await model.getFor(projectId, userId)).toMatchObject({
      enabled: true,
      events: '["build:approved"]',
    });
  });

  it("rejects notification toggles for foreign projects", async () => {
    const form = new FormData();
    form.set("slug", "ghost");
    form.set("enabled", "1");
    const response = await postForm("/profile/notifications", form, testApp(await seed()));
    expect(response.status).toBe(400);
  });
});

describe("profile devices", () => {
  const sessions = ["tok-a", "tok-b"].map((token) => ({
    id: `id-${token}`,
    token,
    ipAddress: "10.0.0.1",
    userAgent: `Agent ${token}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-02-01T00:00:00.000Z",
  }));

  /** The row of the page that is marked as this device, found by its user agent. */
  async function thisDevice(cookie: string): Promise<string[]> {
    const auth = stubAuth(null, {
      check: async () => await Promise.resolve(accountUser),
      listSessions: async () => await Promise.resolve(sessions),
    });
    const seeded = await seed();
    const app = createShelfApp({
      database: seeded.db,
      storage: seeded.storage,
      auth,
      logger: silentLogger,
      config: { secret },
    });
    const html = await (await app.request("/profile", { headers: { cookie } })).text();
    const rows = html.split("<tr").filter((row) => row.includes("Agent tok-"));
    return rows
      .filter((row) => row.includes("This device"))
      .map((row) => /Agent (tok-\w)/u.exec(row)?.[1] ?? "");
  }

  it("marks the device whose session cookie is sent over http", async () => {
    expect(await thisDevice("storyshelf_session=tok-b.signature")).toEqual(["tok-b"]);
  });

  it("marks the device whose __Secure- session cookie is sent over https", async () => {
    expect(await thisDevice("__Secure-storyshelf_session=tok-a.signature")).toEqual(["tok-a"]);
  });

  it("marks no device without a session cookie", async () => {
    expect(await thisDevice("other=1")).toEqual([]);
  });
});
