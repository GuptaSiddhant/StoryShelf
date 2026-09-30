import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { AuthUser } from "@storyshelf/core/types";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

const admin: AuthUser = { id: "admin_1", email: "a@example.com", name: "A", role: "admin" };
const viewer: AuthUser = { id: "viewer_1", email: "v@example.com", name: "V", role: "member" };

function authFor(user: AuthUser | null) {
  return stubAuth(null, {
    check: async (request: Request) => {
      const cookie = request.headers.get("cookie") ?? "";
      if (cookie.includes("storyshelf_session=admin")) {
        return admin;
      }
      if (cookie.includes("storyshelf_session=viewer")) {
        return viewer;
      }
      return user;
    },
  });
}

function stubProvider(kind: string, ok = true) {
  const schema = ok
    ? z.object({}).loose()
    : z.object({}).refine(() => false, { message: "bad config" });
  const metadata = {
    name: kind,
    version: "0.0.0",
    kind,
    category: "notifier" as const,
    schema,
  };
  return {
    metadata,
    create: () => ({ metadata, send: async () => {} }),
  };
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
  await db.insert(db.tables.projectMembers, {
    id: "m1",
    projectId: "p1",
    userId: viewer.id,
    role: "viewer",
    source: "manual",
    createdAt: now,
  });
  return { db, storage };
}

function appWith(db: ReturnType<typeof makeDatabase>["db"], storage: unknown) {
  return createShelfApp({
    database: db,
    storage: storage as never,
    auth: authFor(null),
    notifiers: [stubProvider("log"), stubProvider("strict", false)],
    logger: pino({ level: "silent" }),
  });
}

const adminCookie = { cookie: "storyshelf_session=admin" };
const viewerCookie = { cookie: "storyshelf_session=viewer" };

describe("notification channels", () => {
  it("creates and lists project channels as admin", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage);
    const created = await app.request("/api/v1/projects/notify-project/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminCookie },
      body: JSON.stringify({ provider: "log", config: {}, events: ["build:created"] }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; hasSecret: boolean; events: string[] };
    expect(body.id).toBeDefined();
    expect(body.hasSecret).toBe(false);
    expect(body.events).toEqual(["build:created"]);

    const listed = await app.request("/api/v1/projects/notify-project/notification-channels", {
      headers: adminCookie,
    });
    expect(listed.status).toBe(200);
    expect((await listed.json()) as unknown[]).toHaveLength(1);
  });

  it("rejects unknown providers and invalid configs", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage);
    const unknown = await app.request("/api/v1/projects/notify-project/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminCookie },
      body: JSON.stringify({ provider: "carrier-pigeon", config: {} }),
    });
    expect(unknown.status).toBe(400);
    const invalid = await app.request("/api/v1/projects/notify-project/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminCookie },
      body: JSON.stringify({ provider: "strict", config: {} }),
    });
    expect(invalid.status).toBe(400);
  });

  it("forbids viewers from managing channels", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage);
    const listed = await app.request("/api/v1/projects/notify-project/notification-channels", {
      headers: viewerCookie,
    });
    expect(listed.status).toBe(403);
    const created = await app.request("/api/v1/projects/notify-project/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json", ...viewerCookie },
      body: JSON.stringify({ provider: "log", config: {} }),
    });
    expect(created.status).toBe(403);
  });

  it("deletes project channels and scopes ids to the project", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage);
    const created = await app.request("/api/v1/projects/notify-project/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminCookie },
      body: JSON.stringify({ provider: "log", config: {} }),
    });
    const { id } = (await created.json()) as { id: string };
    const deleted = await app.request(
      `/api/v1/projects/notify-project/notification-channels/${id}`,
      { method: "DELETE", headers: adminCookie },
    );
    expect(deleted.status).toBe(204);
    const again = await app.request(`/api/v1/projects/notify-project/notification-channels/${id}`, {
      method: "DELETE",
      headers: adminCookie,
    });
    expect(again.status).toBe(404);
  });

  it("manages site-wide channels as site admin only", async () => {
    const { db, storage } = await seed();
    const app = appWith(db, storage);
    const forbidden = await app.request("/api/v1/admin/notification-channels", {
      headers: viewerCookie,
    });
    expect(forbidden.status).toBe(403);
    const created = await app.request("/api/v1/admin/notification-channels", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminCookie },
      body: JSON.stringify({ provider: "log", config: {}, events: ["sys:purge-completed"] }),
    });
    expect(created.status).toBe(201);
    const listed = await app.request("/api/v1/admin/notification-channels", {
      headers: adminCookie,
    });
    expect((await listed.json()) as unknown[]).toHaveLength(1);
  });
});
