import { MemberModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { contentKey, storybookDir } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";

/** `GET /api/v1/offline` (ADR 0048, decision 3): access, omission rules, body and caching. */

const NOW = "2026-01-01T00:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

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

function project(id: string, slug: string) {
  return {
    id,
    name: `Name ${slug}`,
    slug,
    gitRepository: "acme/widgets",
    gitDefaultBranch: "main",
    createdAt: NOW,
    updatedAt: NOW,
  };
}
function build(id: string, projectId: string, status: string, branch = "main") {
  return {
    id,
    projectId,
    gitSha: "c".repeat(40),
    gitBranch: branch,
    isDefault: branch === "main",
    public: false,
    status,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function boot(options: { noAuth?: boolean; maxOfflineDays?: number } = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  await db.insert(db.tables.projects, project("p1", "private-ok"));
  await db.insert(db.tables.projects, project("p2", "no-build"));
  await db.insert(db.tables.projects, project("p3", "unpublished"));
  await db.insert(db.tables.builds, build("b1", "p1", "approved") as never);
  await db.insert(db.tables.builds, build("b2", "p3", "approved") as never);
  await db.insert(db.tables.builds, build("b3", "p2", "approved", "feature/x") as never);
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
  await storage.write(contentKey(HASH_A), Buffer.from("12345"));
  await storage.write(contentKey(HASH_B), Buffer.from("123"));
  await storage.write(
    `${storybookDir("p1", "b1")}/manifest.json`,
    Buffer.from(
      JSON.stringify({ "index.html": HASH_A, "assets/a.js": HASH_B, "copy.html": HASH_A }),
    ),
  );
  const app = createShelfApp({
    database: db,
    storage,
    ...(options.noAuth === true ? {} : { auth }),
    config: {
      secret: "s",
      publicBaseUrl: "https://shelf.example",
      ...(options.maxOfflineDays === undefined
        ? {}
        : { offline: { maxOfflineDays: options.maxOfflineDays } }),
    },
    logger: pino({ level: "silent" }),
  });
  await app.lifecycle.setup();
  const get = async (session: string | null, slugs: string): Promise<Response> => {
    const headers = new Headers();
    if (session) headers.set("cookie", `storyshelf_session=${session}`);
    return await app.request(`/api/v1/offline?projects=${slugs}`, { headers });
  };
  return { get };
}

const ALL = "private-ok,no-build,unpublished,nope";

describe("GET /api/v1/offline", () => {
  it("gives a viewer the default-branch build with sized manifest entries", async () => {
    const { get } = await boot();
    const response = await get("view", ALL);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as { projects: Record<string, unknown>[] };
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toEqual({
      slug: "private-ok",
      name: "Name private-ok",
      buildId: "b1",
      commit: "c".repeat(40),
      maxOfflineDays: 30,
      entries: expect.arrayContaining([
        { path: "index.html", hash: HASH_A, size: 5 },
        { path: "assets/a.js", hash: HASH_B, size: 3 },
        { path: "copy.html", hash: HASH_A, size: 5 },
      ]),
    });
  });

  it("gives an admin the same answer, with the configured maxOfflineDays", async () => {
    const { get } = await boot({ maxOfflineDays: 7 });
    const body = (await (await get("admin", "private-ok")).json()) as {
      projects: { maxOfflineDays: number }[];
    };
    expect(body.projects.map((p) => p.maxOfflineDays)).toEqual([7]);
  });

  it.each([
    ["a signed-in user with no role", "outsider"],
    ["an anonymous caller", null],
  ])("leaves a private project out for %s, with no error", async (_label, session) => {
    const { get } = await boot();
    const response = await get(session, ALL);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projects: [] });
  });

  it("answers an empty list for slugs with no published default-branch build", async () => {
    const { get } = await boot();
    expect(await (await get("admin", "no-build,unpublished,nope")).json()).toEqual({
      projects: [],
    });
  });

  it("serves an instance without sign-in to anyone", async () => {
    const { get } = await boot({ noAuth: true });
    const body = (await (await get(null, "private-ok")).json()) as { projects: unknown[] };
    expect(body.projects).toHaveLength(1);
  });
});
