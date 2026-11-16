import { MemberModel, SnapshotModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { SnapshotStatus } from "@storyshelf/core/types";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

/** The addon's one endpoint (ADR 0042, decision 3): access, caching and body shape. */

const NOW = "2026-01-01T00:00:00.000Z";
const URL_PATH = "/api/v1/projects/gate/builds/b1/story-status";

const users = [
  { id: "admin", email: "admin@example.com", name: "Admin", role: "admin" as const },
  { id: "view", email: "view@example.com", name: "View", role: "member" as const },
  { id: "outsider", email: "out@example.com", name: "Out", role: "member" as const },
];

const auth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    const id = /storyshelf_session=(?<id>\w+)/u.exec(cookie)?.groups?.["id"];
    return await Promise.resolve(users.find((user) => user.id === id) ?? null);
  },
});

async function seedSnapshot(
  model: SnapshotModel,
  storyId: string,
  viewportName: string,
  status: SnapshotStatus,
): Promise<void> {
  const created = await model.create("p1", "b1", {
    storyId,
    storyName: "N",
    storyTitle: "T",
    storyImportPath: "./T.tsx",
    viewportName,
    viewportWidth: 800,
    viewportHeight: 600,
    screenshotPath: `shots/${storyId}-${viewportName}.png`,
  });
  await model.setStatus(created.id, status);
}

async function boot(options: { testing?: boolean; noAuth?: boolean } = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "Gate",
    slug: "gate",
    gitRepository: "acme/widgets",
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "a".repeat(40),
    gitBranch: "feature/x",
    isDefault: false,
    public: false,
    status: "reviewing",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  await Promise.all(
    users.map(
      async (user) =>
        await db.insert(db.tables.users, {
          ...user,
          avatarUrl: null,
          lastLoginAt: null,
          createdAt: NOW,
        }),
    ),
  );
  await new MemberModel(db).set("p1", "view", "viewer");
  const snapshots = new SnapshotModel(db);
  await seedSnapshot(snapshots, "a--one", "desktop", "unchanged");
  await seedSnapshot(snapshots, "a--one", "mobile", "changed");
  await seedSnapshot(snapshots, "a--two", "desktop", "approved");
  const app = createShelfApp({
    database: db,
    storage,
    ...(options.noAuth === true ? {} : { auth }),
    ...(options.testing === false ? {} : { testing: { runner: stubRunner() } }),
    config: { secret: "s", publicBaseUrl: "https://shelf.example" },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  const get = async (session: string | null, path = URL_PATH): Promise<Response> => {
    const headers = new Headers();
    if (session) headers.set("cookie", `storyshelf_session=${session}`);
    return await app.request(path, { headers });
  };
  return { get };
}

describe("GET story-status", () => {
  it("gives a viewer the worst status per story and a relative review path", async () => {
    const { get } = await boot();
    const response = await get("view");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      build: { status: "reviewing", reviewPath: "/projects/gate/builds/b1/diff" },
      stories: { "a--one": { status: "changed" }, "a--two": { status: "approved" } },
    });
  });

  it("omits a story that has no snapshot and carries no images, keys or identities", async () => {
    const { get } = await boot();
    const text = await (await get("view")).text();
    expect(text).not.toContain("a--none");
    for (const leak of ["screenshotPath", "shots/", "reviewedBy", "email", "http"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("gives no badges without a session, and says private, no-store", async () => {
    const { get } = await boot();
    const response = await get(null);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("a--one");
  });

  it("answers 404 to a signed-in user without access to the project", async () => {
    const { get } = await boot();
    const response = await get("outsider");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers 404 for an unknown build, still private, no-store", async () => {
    const { get } = await boot();
    const response = await get("view", "/api/v1/projects/gate/builds/nope/story-status");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers 404 without testing, still private, no-store", async () => {
    const { get } = await boot({ testing: false });
    const response = await get("view");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("serves an instance without sign-in", async () => {
    const { get } = await boot({ noAuth: true });
    expect((await get(null)).status).toBe(200);
  });

  it("sends no CORS headers", async () => {
    const { get } = await boot();
    const response = await get("view");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("accepts no method but GET", async () => {
    const { get } = await boot();
    expect((await get("view")).status).toBe(200);
  });
});
