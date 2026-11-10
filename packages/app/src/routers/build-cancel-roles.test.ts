import { BuildModel, MemberModel } from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import type { ProjectRole } from "@storyshelf/core/types";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

/**
 * Who may cancel a build: developer access like retry. A viewer is refused (403); a caller who cannot
 * see the project at all (an outsider, an anonymous visitor) gets 404, so its existence is not
 * revealed. Through the JSON API and through the build page's form (an HTMX post to the same route).
 */
const NOW = "2026-01-01T00:00:00.000Z";
const ROLES: Record<string, ProjectRole> = {
  admin: "admin",
  approver: "approver",
  developer: "developer",
  viewer: "viewer",
};
const users = [...Object.keys(ROLES), "outsider"].map((id) => ({
  id,
  email: `${id}@example.com`,
  name: id,
  role: id === "admin" ? ("admin" as const) : ("member" as const),
}));
const auth = stubAuth(null, {
  check: async (request: Request) => {
    const cookie = request.headers.get("cookie") ?? "";
    const id = /storyshelf_session=(?<id>\w+)/u.exec(cookie)?.groups?.["id"];
    return await Promise.resolve(users.find((user) => user.id === id) ?? null);
  },
});

const apps: ReturnType<typeof createShelfApp>[] = [];
afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

async function seed() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await createTestProject(db, db.tables, { name: "app" });
  const build = await createTestBuild(db, db.tables, project.id);
  await new BuildModel(db).setStatus(build.id, "capturing");
  for (const user of users) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- a handful of rows, in order
    await db.insert(db.tables.users, {
      ...user,
      avatarUrl: null,
      lastLoginAt: null,
      createdAt: NOW,
    });
  }
  for (const [id, role] of Object.entries(ROLES)) {
    if (id !== "admin") {
      // oxlint-disable-next-line eslint/no-await-in-loop -- a handful of rows, in order
      await new MemberModel(db).set(project.id, id, role);
    }
  }
  const app = createShelfApp({
    database: db,
    storage,
    auth,
    testing: { runner: stubRunner() },
    config: { secret: "s", publicBaseUrl: "https://shelf.example" },
    logger: pino({ level: "silent" }),
  });
  apps.push(app);
  return { app, db, build };
}

const VARIANTS = {
  api: {},
  "page form": { "hx-request": "true" },
} as const;

describe.each(Object.entries(VARIANTS))("cancel through the %s", (_name, headers) => {
  it.each([
    ["admin", 200],
    ["approver", 200],
    ["developer", 200],
    ["viewer", 403],
    ["outsider", 404],
  ])("%s gets %i and a refused cancel leaves the build alone", async (id, status) => {
    const { app, db, build } = await seed();
    const response = await app.request(`/api/v1/projects/app/builds/${build.id}/cancel`, {
      method: "POST",
      headers: { cookie: `storyshelf_session=${id}`, ...headers },
    });
    expect(response.status).toBe(status);
    const after = (await new BuildModel(db).get(build.id))?.status;
    expect(after).toBe(status === 200 ? "cancelled" : "capturing");
  });

  it("answers an anonymous visitor 404 (auth on, no user) and leaves the build alone", async () => {
    const { app, db, build } = await seed();
    const response = await app.request(`/api/v1/projects/app/builds/${build.id}/cancel`, {
      method: "POST",
      headers,
    });
    expect(response.status).toBe(404);
    expect((await new BuildModel(db).get(build.id))?.status).toBe("capturing");
  });
});
