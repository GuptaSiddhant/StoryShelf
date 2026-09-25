import { MemberModel } from "@storyshelf/core/models";
import { TokenModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { sha256 } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

const admin = { id: "user_1", email: "ada@example.com", name: "Ada", role: "admin" as const };
const dev = { id: "dev_1", email: "dev@example.com", name: "Dev", role: "member" as const };

const passwordAuth = {
  metadata: { name: "Stub Auth", version: "0.0.0", kind: "stub", category: "auth" as const },
  check: async (request: Request): Promise<typeof admin | typeof dev | null> => {
    await Promise.resolve();
    const cookie = request.headers.get("cookie") ?? "";
    if (cookie.includes("storyshelf_session=admin")) {
      return admin;
    }
    if (cookie.includes("storyshelf_session=dev")) {
      return dev;
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
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Token Project",
    slug: "token-project",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  await Promise.all(
    [
      { ...admin, avatarUrl: null, lastLoginAt: null, createdAt: now },
      { ...dev, avatarUrl: null, lastLoginAt: null, createdAt: now },
    ].map(async (user) => {
      await db.insert(db.tables.users, user);
    }),
  );
  await new MemberModel(db, { projectMembers: db.tables.projectMembers }).set(
    "p1",
    dev.id,
    "developer",
  );
  const app = createShelfApp({
    database: db,
    storage,
    auth: passwordAuth,
    logger: silentLogger,
    config: { secret: "s" },
  });
  return { app, db };
}

async function mint(
  db: ReturnType<typeof makeDatabase>["db"],
  name: string,
  value: string,
  userId: string | null,
): Promise<void> {
  await new TokenModel(db, { tokens: db.tables.tokens }).create("p1", {
    name,
    hash: sha256(value),
    userId,
  });
}

const BUILD_BODY = JSON.stringify({ gitSha: "sha-1", gitBranch: "main" });

describe("bearer token permissions", () => {
  it("resolves a developer token to developer access", async () => {
    const { app, db } = await seed();
    await mint(db, "dev-ci", "dev-token", dev.id);

    const upload = await app.request("/api/v1/projects/token-project/builds", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer dev-token" },
      body: BUILD_BODY,
    });
    expect(upload.status).toBe(202);

    const manage = await app.request("/api/v1/projects/token-project/tokens", {
      headers: { authorization: "Bearer dev-token" },
    });
    expect(manage.status).toBe(403);
  });

  it("resolves an admin token to admin access", async () => {
    const { app, db } = await seed();
    await mint(db, "admin-ci", "admin-token", admin.id);

    const response = await app.request("/api/v1/projects/token-project/tokens", {
      headers: { authorization: "Bearer admin-token" },
    });
    expect(response.status).toBe(200);
  });

  it("downgrades legacy ownerless tokens to viewer", async () => {
    const { app, db } = await seed();
    await mint(db, "legacy-ci", "legacy-token", null);

    const read = await app.request("/api/v1/projects/token-project", {
      headers: { authorization: "Bearer legacy-token" },
    });
    expect(read.status).toBe(200);

    const upload = await app.request("/api/v1/projects/token-project/builds", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer legacy-token" },
      body: BUILD_BODY,
    });
    expect(upload.status).toBe(403);
  });

  it("denies tokens whose owner no longer exists", async () => {
    const { app, db } = await seed();
    await mint(db, "ghost-ci", "ghost-token", "ghost");

    const read = await app.request("/api/v1/projects/token-project", {
      headers: { authorization: "Bearer ghost-token" },
    });
    expect(read.status).toBe(403);
  });

  it("binds created tokens to the session creator", async () => {
    const { app, db } = await seed();
    const response = await app.request("/api/v1/projects/token-project/tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "storyshelf_session=dev",
      },
      body: JSON.stringify({ name: "ci" }),
    });
    // dev is developer, not project admin: creation is forbidden
    expect(response.status).toBe(403);

    const created = await app.request("/api/v1/projects/token-project/tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "storyshelf_session=admin",
      },
      body: JSON.stringify({ name: "ci" }),
    });
    expect(created.status).toBe(201);
    const listed = await new TokenModel(db, { tokens: db.tables.tokens }).list("p1");
    const row = listed.find((token) => token.name === "ci");
    expect(row?.userId).toBe(admin.id);
  });

  it("keeps tokens scoped to their own project", async () => {
    const { app, db } = await seed();
    await mint(db, "dev-ci", "dev-token", dev.id);

    const response = await app.request("/api/v1/projects/other-slug", {
      headers: { authorization: "Bearer dev-token" },
    });
    expect(response.status).toBe(403);
  });
});
