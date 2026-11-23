import { MemberModel } from "@storyshelf/core/models";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import type { SiteRole } from "@storyshelf/core/types";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "./index.tsx";
import { visibleProjects } from "./project-visibility.ts";
import { stubAuth } from "./stub-auth.ts";

const NOW = "2026-11-21T00:00:00.000Z";

async function seed() {
  const { db } = makeDatabase();
  await Promise.all(
    ["alpha", "beta"].map(
      async (slug) =>
        await db.insert(db.tables.projects, {
          id: `p-${slug}`,
          name: slug,
          slug,
          gitRepository: null,
          gitDefaultBranch: "main",
          createdAt: NOW,
          updatedAt: NOW,
        }),
    ),
  );
  await new MemberModel(db).set("p-alpha", "u1", "viewer");
  return db;
}

function userWith(role: SiteRole) {
  return { id: "u1", email: "u1@example.com", name: "U", role };
}

async function slugsFor(viewer: Parameters<typeof visibleProjects>[1]): Promise<string[]> {
  const projects = await visibleProjects(await seed(), viewer);
  return projects.map((project) => project.slug).toSorted();
}

describe("visibleProjects", () => {
  it("lists every project with auth off", async () => {
    await expect(slugsFor({ authEnabled: false, user: null })).resolves.toEqual(["alpha", "beta"]);
  });

  it("lists only the member's projects for a site member", async () => {
    await expect(slugsFor({ authEnabled: true, user: userWith("member") })).resolves.toEqual([
      "alpha",
    ]);
  });

  it("lists every project for a site viewer", async () => {
    await expect(slugsFor({ authEnabled: true, user: userWith("viewer") })).resolves.toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("lists every project for a site admin", async () => {
    await expect(slugsFor({ authEnabled: true, user: userWith("admin") })).resolves.toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("lists nothing with auth on and nobody signed in", async () => {
    await expect(slugsFor({ authEnabled: true, user: null })).resolves.toEqual([]);
  });
});

async function listsFor(role: SiteRole): Promise<{ page: string; api: string[] }> {
  const db = await seed();
  const user = userWith(role);
  const auth = stubAuth(null, {
    check: async (request: Request) =>
      (request.headers.get("cookie") ?? "").includes("storyshelf_session=u1") ? user : null,
  });
  const { storage } = makeStorage();
  const app = createShelfApp({ database: db, storage, auth, logger: pino({ level: "silent" }) });
  const headers = { cookie: "storyshelf_session=u1" };
  const page = await (await app.request("/projects", { headers })).text();
  const api = (await (await app.request("/api/v1/projects", { headers })).json()) as {
    slug: string;
  }[];
  return { page, api: api.map((project) => project.slug).toSorted() };
}

describe("project lists through the app", () => {
  it("hides a project a site member has no role on, on the page and in the API", async () => {
    const { page, api } = await listsFor("member");
    expect(api).toEqual(["alpha"]);
    expect(page).toContain("/projects/alpha/");
    expect(page).not.toContain("/projects/beta/");
  });

  it("lists every project for a site viewer and a site admin", async () => {
    const lists = await Promise.all(
      (["viewer", "admin"] as const).map(async (role) => await listsFor(role)),
    );
    for (const { page, api } of lists) {
      expect(api).toEqual(["alpha", "beta"]);
      expect(page).toContain("/projects/beta/");
    }
  });
});
