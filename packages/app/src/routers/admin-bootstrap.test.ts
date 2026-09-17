import { MemberModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { projectMembers } from "@storyshelf/db-sqlite/schema";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });
const ADMIN_TOKEN = "adm-bootstrap-123";

const admin = { id: "user_1", email: "ada@example.com", name: "Ada", role: "admin" as const };

const passwordAuth = {
  metadata: { name: "Stub Auth", version: "0.0.0", kind: "stub", category: "auth" as const },
  check: async (request: Request): Promise<typeof admin | null> => {
    await Promise.resolve();
    const cookie = request.headers.get("cookie") ?? "";
    return cookie.includes("storyshelf_session=ok") ? admin : null;
  },
  createSession: async (): Promise<string> => {
    await Promise.resolve();
    return "ok";
  },
  destroySession: async (): Promise<void> => {
    await Promise.resolve();
  },
};

function appWithToken() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    auth: passwordAuth,
    logger: silentLogger,
    config: { adminToken: ADMIN_TOKEN, secret: "s" },
  });
  return { app, db };
}

function appWithoutToken() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const app = createShelfApp({
    database: db,
    storage,
    auth: passwordAuth,
    logger: silentLogger,
    config: { secret: "s" },
  });
  return { app, db };
}

describe("admin token bootstrap", () => {
  it("grants site-admin project creation via Bearer admin token", async () => {
    const { app } = appWithToken();
    const response = await app.request("/api/v1/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({ name: "Bootstrap Project" }),
    });
    expect(response.status).toBe(201);
  });

  it("rejects wrong bearer tokens with 403", async () => {
    const { app } = appWithToken();
    const response = await app.request("/api/v1/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(response.status).toBe(403);
  });

  it("rejects unauthenticated creation with 403 when no token is configured", async () => {
    const { app } = appWithoutToken();
    const response = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(response.status).toBe(403);
  });

  it("grants the purge endpoint via Bearer admin token", async () => {
    const { app } = appWithToken();
    const response = await app.request("/api/v1/admin/purge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
  });

  it("adds the session creator as project admin", async () => {
    const { app, db } = appWithToken();
    const response = await app.request("/api/v1/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "storyshelf_session=ok",
      },
      body: JSON.stringify({ name: "Owned Project" }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    const member = await new MemberModel(db, { projectMembers }).get(created.id, admin.id);
    expect(member?.role).toBe("admin");
  });

  it("adds no membership for admin-token creation", async () => {
    const { app, db } = appWithToken();
    const response = await app.request("/api/v1/projects", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({ name: "Token Project" }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    const members = await new MemberModel(db, { projectMembers }).list(created.id);
    expect(members).toHaveLength(0);
  });
});
