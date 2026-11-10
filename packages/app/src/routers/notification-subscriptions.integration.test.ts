import type { NotifierProvider } from "@storyshelf/core/adapter/notifier";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { AuthUser } from "@storyshelf/core/types";
import { pino } from "pino";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const admin: AuthUser = { id: "admin_1", email: "a@example.com", name: "A", role: "admin" };
const member: AuthUser = { id: "member_1", email: "m@example.com", name: "M", role: "member" };

function authFor() {
  return stubAuth(null, {
    check: async (request: Request) => {
      const cookie = request.headers.get("cookie") ?? "";
      if (cookie.includes("storyshelf_session=admin")) {
        return admin;
      }
      if (cookie.includes("storyshelf_session=member")) {
        return member;
      }
      return null;
    },
  });
}

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
    [admin, member].map(async (user) =>
      db.insert(db.tables.users, {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: null,
        role: user.role,
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
    userId: member.id,
    role: "developer",
    source: "manual",
    createdAt: now,
  });
  return { db, storage };
}

function notifier(kind: string, name: string, audience: "person" | "room"): NotifierProvider {
  const metadata = {
    name,
    version: "0.0.0",
    kind,
    category: "notifier" as const,
    audience,
    schema: z.object({}).loose(),
  };
  return { metadata, create: () => ({ metadata, send: async () => {} }) };
}

function appWith(
  db: ReturnType<typeof makeDatabase>["db"],
  storage: unknown,
  notifiers: NotifierProvider[] = [],
) {
  return createShelfApp({
    database: db,
    storage: storage as never,
    auth: authFor(),
    logger: pino({ level: "silent" }),
    ...(notifiers.length > 0 ? { notifications: { notifiers } } : {}),
  });
}

const adminCookie = { cookie: "storyshelf_session=admin" };
const memberCookie = { cookie: "storyshelf_session=member" };
const mePath = "/api/v1/projects/notify-project/notifications/me";

describe("notification subscriptions", () => {
  it("returns null before opt-in and round-trips put/delete", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage);
    const before = await app.request(mePath, { headers: memberCookie });
    expect(before.status).toBe(200);
    expect(await before.json()).toBeNull();

    const saved = await app.request(mePath, {
      method: "PUT",
      headers: { "content-type": "application/json", ...memberCookie },
      body: JSON.stringify({ events: ["build:reviewing"], via: ["email"] }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ events: ["build:reviewing"], via: ["email"] });

    const removed = await app.request(mePath, { method: "DELETE", headers: memberCookie });
    expect(removed.status).toBe(204);
    const after = await app.request(mePath, { headers: memberCookie });
    expect(await after.json()).toBeNull();
  });

  it("reports review requests on by default and keeps an explicit off across later saves", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage);
    const put = async (body: unknown) =>
      await app.request(mePath, {
        method: "PUT",
        headers: { "content-type": "application/json", ...memberCookie },
        body: JSON.stringify(body),
      });
    expect(await (await put({ via: ["email"] })).json()).toMatchObject({ reviewRequests: true });
    expect(await (await put({ via: ["email"], reviewRequests: false })).json()).toMatchObject({
      reviewRequests: false,
    });
    const later = await put({ events: ["build:approved"], via: ["email"] });
    expect(await later.json()).toMatchObject({ reviewRequests: false });
    const read = await app.request(mePath, { headers: memberCookie });
    expect(await read.json()).toMatchObject({ reviewRequests: false });
  });

  it("changes only the switch on a PUT that carries only reviewRequests", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage);
    const put = async (body: unknown) =>
      await app.request(mePath, {
        method: "PUT",
        headers: { "content-type": "application/json", ...memberCookie },
        body: JSON.stringify(body),
      });
    await put({ events: ["build:approved"], via: ["email"], enabled: false });
    const flipped = await put({ reviewRequests: false });
    expect(await flipped.json()).toMatchObject({
      events: ["build:approved"],
      via: ["email"],
      enabled: false,
      reviewRequests: false,
    });
  });

  it("answers a review-only PUT without a subscription with the defaults and stores nothing on", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage);
    const res = await app.request(mePath, {
      method: "PUT",
      headers: { "content-type": "application/json", ...memberCookie },
      body: JSON.stringify({ reviewRequests: true }),
    });
    expect(await res.json()).toMatchObject({ enabled: false, events: [], reviewRequests: true });
    const read = await app.request(mePath, { headers: memberCookie });
    expect(await read.json()).toBeNull();
  });

  it("refuses a room kind with a 422 naming it, and accepts personal and unwired kinds", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage, [
      notifier("email", "Email", "person"),
      notifier("slack-webhook", "Slack", "room"),
    ]);
    const put = async (via: string[]) =>
      await app.request(mePath, {
        method: "PUT",
        headers: { "content-type": "application/json", ...memberCookie },
        body: JSON.stringify({ via }),
      });
    const refused = await put(["email", "slack-webhook"]);
    expect(refused.status).toBe(422);
    expect(await refused.text()).toContain(
      "Slack (slack-webhook) posts to a room; add it as a project channel instead",
    );
    expect((await put(["email"])).status).toBe(200);
    expect((await put(["not-wired"])).status).toBe(200);
  });

  it("isolates subscriptions per user", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage);
    await app.request(mePath, {
      method: "PUT",
      headers: { "content-type": "application/json", ...memberCookie },
      body: JSON.stringify({ via: ["email"] }),
    });
    const adminView = await app.request(mePath, { headers: adminCookie });
    expect(await adminView.json()).toBeNull();
  });

  it("rejects anonymous callers and audits as admin", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage);
    const anon = await app.request(mePath);
    expect(anon.status).toBe(403);
    const openApp = createShelfApp({
      database: db,
      storage: storage as never,
      logger: pino({ level: "silent" }),
    });
    const anonOpen = await openApp.request(mePath);
    expect(anonOpen.status).toBe(401);
    await app.request(mePath, {
      method: "PUT",
      headers: { "content-type": "application/json", ...memberCookie },
      body: JSON.stringify({ via: ["email"] }),
    });
    const audit = await app.request("/api/v1/projects/notify-project/notifications", {
      headers: adminCookie,
    });
    expect(audit.status).toBe(200);
    expect((await audit.json()) as unknown[]).toHaveLength(1);
    const memberAudit = await app.request("/api/v1/projects/notify-project/notifications", {
      headers: memberCookie,
    });
    expect(memberAudit.status).toBe(403);
  });
});
