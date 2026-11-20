import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubRunner } from "../test-runner.ts";

interface SeedOptions {
  testing?: boolean;
  supersedeOnCreate?: boolean;
  cancelSuperseded?: boolean;
}

async function seed({
  testing = true,
  supersedeOnCreate = true,
  cancelSuperseded,
}: SeedOptions = {}) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await createTestProject(db, db.tables, { name: "web" });
  if (cancelSuperseded !== undefined) {
    await new ProjectModel(db).update(project.id, { cancelSuperseded });
  }
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    config: { secret: "s", publicBaseUrl: "https://shelf.example", supersedeOnCreate },
    ...(testing ? { testing: { runner: stubRunner() } } : {}),
  });
  const build = async (
    gitSha: string,
    gitBranch = "feature/x",
    status?: "capturing" | "reviewing",
  ) => {
    const created = await createTestBuild(db, db.tables, project.id, { gitSha, gitBranch });
    if (status === "reviewing") await new BuildModel(db).setStatus(created.id, "capturing");
    if (status) await new BuildModel(db).setStatus(created.id, status);
    return created;
  };
  const create = async (supersedes: string[]) =>
    await app.request("/api/v1/projects/web/builds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gitSha: "new-sha", gitBranch: "feature/x", supersedes }),
    });
  const statusOf = async (id: string) => (await new BuildModel(db).get(id))?.status;
  return { app, db, project, build, create, statusOf };
}

describe("GET /builds/in-flight", () => {
  it("lists only the branch's cancellable builds", async () => {
    const { app, build } = await seed();
    const pending = await build("a1");
    const capturing = await build("a2", "feature/x", "capturing");
    await build("a3", "feature/x", "reviewing");
    await build("a4", "other");
    const response = await app.request("/api/v1/projects/web/builds/in-flight?branch=feature/x");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; sha: string }[];
    expect(body.toSorted((a, b) => a.sha.localeCompare(b.sha))).toEqual([
      { id: pending.id, sha: "a1" },
      { id: capturing.id, sha: "a2" },
    ]);
  });

  it("answers 404 without testing", async () => {
    const { app } = await seed({ testing: false });
    const response = await app.request("/api/v1/projects/web/builds/in-flight?branch=main");
    expect(response.status).toBe(404);
  });

  it("requires a branch", async () => {
    const { app } = await seed();
    expect((await app.request("/api/v1/projects/web/builds/in-flight")).status).toBe(400);
  });
});

describe("POST /builds with supersedes", () => {
  it("cancels the older in-flight builds when the option and the setting are on", async () => {
    const { build, create, statusOf } = await seed();
    const older = await build("a1");
    const response = await create([older.id]);
    expect(response.status).toBe(202);
    expect(await statusOf(older.id)).toBe("cancelled");
  });

  it("cancels nothing when the project setting is off", async () => {
    const { build, create, statusOf } = await seed({ cancelSuperseded: false });
    const older = await build("a1");
    expect((await create([older.id])).status).toBe(202);
    expect(await statusOf(older.id)).toBe("pending");
  });

  it("cancels nothing when the server option is off (the default)", async () => {
    const { build, create, statusOf } = await seed({ supersedeOnCreate: false });
    const older = await build("a1");
    expect((await create([older.id])).status).toBe(202);
    expect(await statusOf(older.id)).toBe("pending");
  });

  it("ignores another branch, a reviewing build and a newer build, and still succeeds", async () => {
    const { build, create, statusOf, db } = await seed();
    const otherBranch = await build("b1", "other");
    const reviewing = await build("b2", "feature/x", "reviewing");
    const newer = await build("b3");
    await db.update(db.tables.builds, newer.id, { createdAt: "2999-01-01T00:00:00.000Z" });
    const response = await create([otherBranch.id, reviewing.id, newer.id, "missing"]);
    expect(response.status).toBe(202);
    expect(await statusOf(otherBranch.id)).toBe("pending");
    expect(await statusOf(reviewing.id)).toBe("reviewing");
    expect(await statusOf(newer.id)).toBe("pending");
  });

  it("refuses more than 50 ids", async () => {
    const { create } = await seed();
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    expect((await create(ids)).status).toBe(400);
  });
});

describe("PATCH project cancelSuperseded", () => {
  it("reads and writes the setting", async () => {
    const { app } = await seed();
    const response = await app.request("/api/v1/projects/web", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cancelSuperseded: false }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cancelSuperseded: false });
  });
});
