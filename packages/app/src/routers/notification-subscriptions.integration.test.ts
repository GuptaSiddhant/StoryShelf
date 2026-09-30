import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { AuthUser } from "@storyshelf/core/types";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
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

function appWith(db: ReturnType<typeof makeDatabase>["db"], storage: unknown) {
  return createShelfApp({
    database: db,
    storage: storage as never,
    auth: authFor(),
    logger: pino({ level: "silent" }),
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
