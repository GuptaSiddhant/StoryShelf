import { PGlite } from "@electric-sql/pglite";
/** `BuildModel.supersede` and its columns on embedded Postgres (PGlite), including an upgraded old database. */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { runMigrations } from "./migrate.ts";
import { createPgliteDatabase } from "./pglite.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const silent = createShelfLogger({ level: "silent" });

async function open(): Promise<DatabaseAdapter> {
  const db = createPgliteDatabase();
  await db.lifecycle?.setup({ config: {}, logger: silent });
  return db;
}

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:01:00.000Z";
const T2 = "2026-01-01T00:02:00.000Z";

async function seed(db: DatabaseAdapter) {
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "P",
    slug: "p",
    gitDefaultBranch: "main",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  await db.insert(db.tables.projects, {
    id: "p2",
    name: "Q",
    slug: "q",
    gitDefaultBranch: "main",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  const add = async (id: string, extra: Record<string, unknown> = {}) =>
    await db.insert(db.tables.builds, {
      id,
      projectId: "p1",
      gitSha: `sha-${id}`,
      gitBranch: "feature/x",
      status: "capturing",
      createdAt: T0,
      updatedAt: T0,
      ...extra,
    } as never);
  await add("old-pending", { status: "pending" });
  await add("old-capturing");
  await add("old-comparing", { status: "comparing" });
  await add("old-reviewing", { status: "reviewing" });
  await add("old-cancelled", { status: "cancelled" });
  await add("old-other-branch", { gitBranch: "feature/y" });
  await add("old-other-project", { projectId: "p2" });
  await add("old-same-sha", { gitSha: "sha-new" });
  await add("old-commented");
  await add("newer", { createdAt: T2 });
  await add("new", { gitSha: "sha-new", createdAt: T1 });
  await db.insert(db.tables.comments, {
    id: "c1",
    projectId: "p1",
    buildId: "old-commented",
    authorName: "A",
    body: "looks odd",
    createdAt: T0,
    updatedAt: T0,
  } as never);
  return new BuildModel(db);
}

it("cancels only what the ADR allows and records the newer build", async () => {
  const db = await open();
  const builds = await seed(db);
  const newBuild = (await builds.get("new"))!;
  const cancelled: string[] = [];
  const ids = [
    "old-pending",
    "old-capturing",
    "old-comparing",
    "old-reviewing",
    "old-cancelled",
    "old-other-branch",
    "old-other-project",
    "old-same-sha",
    "old-commented",
    "newer",
    "missing",
  ];
  const done = await builds.supersede(newBuild, ids, {
    onCancelled: async (build) => {
      cancelled.push(build.id);
    },
  });
  expect(new Set(done)).toEqual(new Set(["old-capturing", "old-comparing", "old-pending"]));
  expect(new Set(cancelled)).toEqual(new Set(done));
  const marked = await Promise.all(done.map(async (id) => await builds.get(id)));
  for (const row of marked) {
    expect(row).toMatchObject({ status: "cancelled", supersededByBuildId: "new" });
  }
  const untouched = ["old-reviewing", "old-other-branch", "old-other-project", "old-same-sha"];
  const rows = await Promise.all(untouched.map(async (id) => await builds.get(id)));
  for (const row of rows) {
    expect(row).toMatchObject({ supersededByBuildId: null });
  }
  expect(await builds.get("old-reviewing")).toMatchObject({ status: "reviewing" });
  expect(await builds.get("old-commented")).toMatchObject({ status: "capturing" });
  expect(await builds.get("old-cancelled")).toMatchObject({ supersededByBuildId: null });
  expect(await builds.get("newer")).toMatchObject({ status: "capturing" });
  // A second call finds nothing left to cancel.
  expect(await builds.supersede(newBuild, ids)).toEqual([]);
});

it("leaves a build that finished first alone", async () => {
  const db = await open();
  const builds = await seed(db);
  const newBuild = (await builds.get("new"))!;
  await builds.setStatus("old-capturing", "reviewing");
  expect(await builds.supersede(newBuild, ["old-capturing"])).toEqual([]);
  expect(await builds.get("old-capturing")).toMatchObject({
    status: "reviewing",
    supersededByBuildId: null,
  });
});

it("keeps a build the caller says people use", async () => {
  const db = await open();
  const builds = await seed(db);
  const newBuild = (await builds.get("new"))!;
  expect(await builds.supersede(newBuild, ["old-pending"], { keep: async () => true })).toEqual([]);
  expect(await builds.get("old-pending")).toMatchObject({ status: "pending" });
});

it("gives a project the setting on, and round-trips both columns", async () => {
  const db = await open();
  const builds = await seed(db);
  expect(await new ProjectModel(db).get("p1")).toMatchObject({ cancelSuperseded: true });
  await db.update(db.tables.projects, "p1", { cancelSuperseded: false } as never);
  expect(await new ProjectModel(db).get("p1")).toMatchObject({ cancelSuperseded: false });
  await db.update(db.tables.builds, "old-pending", { supersededByBuildId: "new" } as never);
  expect(await builds.get("old-pending")).toMatchObject({ supersededByBuildId: "new" });
});

it("upgrades an existing database: projects get the setting on, builds no superseder", async () => {
  const client = new PGlite();
  await client.exec(readFileSync(new URL("test-fixtures/pre-449.sql", import.meta.url), "utf8"));
  await runMigrations(async (sql) => (await client.exec(sql)).flatMap((result) => result.rows));
  const project = await client.query(
    "SELECT cancel_superseded FROM projects WHERE id = 'p-custom'",
  );
  expect(project.rows).toEqual([{ cancel_superseded: true }]);
  const build = await client.query("SELECT superseded_by_build_id FROM builds WHERE id = 'b1'");
  expect(build.rows).toEqual([{ superseded_by_build_id: null }]);
});
