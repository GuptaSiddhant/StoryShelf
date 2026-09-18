import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { projects } from "@storyshelf/db-sqlite/schema";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

const admin = { id: "user_1", email: "ada@example.com", name: "Ada", role: "admin" as const };
const viewer = { id: "viewer_1", email: "v@example.com", name: "V", role: "viewer" as const };

const stubAuth = {
  metadata: { name: "Stub Auth", version: "0.0.0", kind: "stub", category: "auth" as const },
  check: async (request: Request): Promise<typeof admin | typeof viewer | null> => {
    await Promise.resolve();
    const cookie = request.headers.get("cookie") ?? "";
    if (cookie.includes("storyshelf_session=admin")) {
      return admin;
    }
    if (cookie.includes("storyshelf_session=viewer")) {
      return viewer;
    }
    return null;
  },
  createSession: async (): Promise<string> => {
    await Promise.resolve();
    return "ok";
  },
  destroySession: async (): Promise<void> => {
    await Promise.resolve();
  },
};

async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const now = new Date().toISOString();
  await db.insert(projects, {
    id: "p1",
    name: "Mapping Project",
    slug: "mapping-project",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  const app = createShelfApp({
    database: db,
    storage,
    auth: stubAuth,
    logger: silentLogger,
  });
  return { app, db };
}

const adminCookie = { cookie: "storyshelf_session=admin" };
const viewerCookie = { cookie: "storyshelf_session=viewer" };
const jsonHeaders = { "content-type": "application/json" };

describe("group mapping API", () => {
  it("lists mappings for viewers and manages them as admin", async () => {
    const { app } = await seed();

    const empty = await app.request("/api/v1/projects/mapping-project/group-mappings", {
      headers: viewerCookie,
    });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    const created = await app.request("/api/v1/projects/mapping-project/group-mappings", {
      method: "POST",
      headers: { ...jsonHeaders, ...adminCookie },
      body: JSON.stringify({ groupName: "team-design", role: "developer" }),
    });
    expect(created.status).toBe(201);
    const mapping = (await created.json()) as { id: string; groupName: string; role: string };
    expect(mapping.groupName).toBe("team-design");
    expect(mapping.role).toBe("developer");

    const listed = await app.request("/api/v1/projects/mapping-project/group-mappings", {
      headers: viewerCookie,
    });
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as unknown[]).length).toBe(1);

    const removed = await app.request(
      `/api/v1/projects/mapping-project/group-mappings/${mapping.id}`,
      { method: "DELETE", headers: adminCookie },
    );
    expect(removed.status).toBe(204);
  });

  it("rejects viewer creates and deletes with 403", async () => {
    const { app } = await seed();

    const created = await app.request("/api/v1/projects/mapping-project/group-mappings", {
      method: "POST",
      headers: { ...jsonHeaders, ...viewerCookie },
      body: JSON.stringify({ groupName: "team-x", role: "viewer" }),
    });
    expect(created.status).toBe(403);

    const removed = await app.request("/api/v1/projects/mapping-project/group-mappings/m1", {
      method: "DELETE",
      headers: viewerCookie,
    });
    expect(removed.status).toBe(403);
  });

  it("rejects wildcard group names with 400", async () => {
    const { app } = await seed();
    const response = await app.request("/api/v1/projects/mapping-project/group-mappings", {
      method: "POST",
      headers: { ...jsonHeaders, ...adminCookie },
      body: JSON.stringify({ groupName: "team-*", role: "viewer" }),
    });
    expect(response.status).toBe(400);
  });
});
