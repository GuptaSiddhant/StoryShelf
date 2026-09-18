import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { projects } from "@storyshelf/db-sqlite/schema";
import { Writable } from "node:stream";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";

const viewer = { id: "viewer_1", email: "v@example.com", name: "V", role: "viewer" as const };

const viewerAuth = {
  metadata: { name: "Stub Auth", version: "0.0.0", kind: "stub", category: "auth" as const },
  check: async (request: Request): Promise<typeof viewer | null> => {
    await Promise.resolve();
    const cookie = request.headers.get("cookie") ?? "";
    return cookie.includes("storyshelf_session=viewer") ? viewer : null;
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
    name: "Viewer Project",
    slug: "viewer-project",
    gitRepository: null,
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  return { db, storage };
}

const sessionCookie = { cookie: "storyshelf_session=viewer" };

describe("site viewer auditor role", () => {
  it("reads project, builds, and snapshots without membership", async () => {
    const { db, storage } = await seed();
    const app = createShelfApp({
      database: db,
      storage,
      auth: viewerAuth,
      logger: pino({ level: "silent" }),
    });

    const project = await app.request("/api/v1/projects/viewer-project", {
      headers: sessionCookie,
    });
    expect(project.status).toBe(200);

    const builds = await app.request("/api/v1/projects/viewer-project/builds", {
      headers: sessionCookie,
    });
    expect(builds.status).toBe(200);

    const projectsList = await app.request("/api/v1/projects", { headers: sessionCookie });
    expect(projectsList.status).toBe(200);
  });

  it("cannot mutate: upload, token management, and purge are forbidden", async () => {
    const { db, storage } = await seed();
    const app = createShelfApp({
      database: db,
      storage,
      auth: viewerAuth,
      logger: pino({ level: "silent" }),
    });

    const upload = await app.request("/api/v1/projects/viewer-project/builds", {
      method: "POST",
      headers: { "content-type": "application/json", ...sessionCookie },
      body: JSON.stringify({ gitSha: "sha-1", gitBranch: "main" }),
    });
    expect(upload.status).toBe(403);

    const tokens = await app.request("/api/v1/projects/viewer-project/tokens", {
      headers: sessionCookie,
    });
    expect(tokens.status).toBe(403);

    const purge = await app.request("/api/v1/admin/purge", {
      method: "POST",
      headers: { "content-type": "application/json", ...sessionCookie },
      body: JSON.stringify({}),
    });
    expect(purge.status).toBe(403);
  });
});

describe("request read attribution", () => {
  it("logs the user id on request end for authenticated requests", async () => {
    const { db, storage } = await seed();
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback): void {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = createShelfRouterForLogs(db, storage, sink);

    await app.request("/api/v1/projects/viewer-project", { headers: sessionCookie });

    const ends = lines.map((line) => JSON.parse(line) as { msg?: string; userId?: string });
    const end = ends.find((entry) => entry.msg === "request end");
    expect(end?.userId).toBe(viewer.id);
  });

  it("omits user id for anonymous requests", async () => {
    const { db, storage } = await seed();
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback): void {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = createShelfRouterForLogs(db, storage, sink);

    await app.request("/api/v1/projects/viewer-project");

    const ends = lines.map((line) => JSON.parse(line) as { msg?: string; userId?: string });
    const end = ends.find((entry) => entry.msg === "request end");
    expect(end?.userId).toBeUndefined();
  });
});

function createShelfRouterForLogs(
  db: ReturnType<typeof makeDatabase>["db"],
  storage: ReturnType<typeof makeStorage>["storage"],
  sink: Writable,
): ReturnType<typeof createShelfApp> {
  return createShelfApp({
    database: db,
    storage,
    auth: viewerAuth,
    logger: pino({ level: "info" }, sink),
  });
}
