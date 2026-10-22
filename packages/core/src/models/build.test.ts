import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Logger } from "../logger.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { BuildModel, isPublicBuild } from "./build.ts";
import { ProjectModel } from "./project.ts";

function buildTables(db: DatabaseAdapter) {
  return {
    builds: db.tables.builds,
    buildLabels: db.tables.buildLabels,
    snapshots: db.tables.snapshots,
  };
}

function projectTables(db: DatabaseAdapter) {
  return { projects: db.tables.projects };
}

describe("BuildModel", () => {
  it("creates a build with default status pending", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const build = await model.create(project.id, {
      gitSha: "abc123",
      gitBranch: "main",
    });
    expect(build.id).toBeDefined();
    expect(build.gitSha).toBe("abc123");
    expect(build.gitBranch).toBe("main");
    expect(build.status).toBe("pending");
    expect(build.isDefault).toBe(false);
  });

  it("gets a build by id", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const build = await model.create("p1", { gitSha: "sha-1", gitBranch: "main" });
    const fetched = await model.get(build.id);
    expect(fetched?.id).toBe(build.id);
    expect(fetched?.gitSha).toBe("sha-1");
  });

  it("updates build status", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const build = await model.create("p1", { gitSha: "sha-1", gitBranch: "main" });
    const updated = await model.setStatus(build.id, "capturing" as const);
    expect(updated.status).toBe("capturing");
  });

  it("recomputes build counts", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const build = await model.create("p1", { gitSha: "sha-1", gitBranch: "main" });

    await db.insert(db.tables.snapshots, {
      id: "s1",
      projectId: "p1",
      buildId: build.id,
      storyId: "a",
      storyName: "A",
      storyTitle: "A",
      storyImportPath: "",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshotPath: "/path",
      status: "approved",
      inherited: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.insert(db.tables.snapshots, {
      id: "s2",
      projectId: "p1",
      buildId: build.id,
      storyId: "b",
      storyName: "B",
      storyTitle: "B",
      storyImportPath: "",
      viewportName: "desktop",
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshotPath: "/path",
      status: "changed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const updatedBuild = await model.updateCounts(build.id);
    expect(updatedBuild.snapshotCount).toBe(2);
    expect(updatedBuild.approvedCount).toBe(1);
    expect(updatedBuild.changedCount).toBe(1);
    expect(updatedBuild.inheritedCount).toBe(1);
  });

  it("removes a build", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const build = await model.create("p1", { gitSha: "sha-1", gitBranch: "main" });
    await model.remove(build.id);
    const deleted = await model.get(build.id);
    expect(deleted).toBeNull();
  });
});

function publicTestProject(publicBranchRegex: string | null): { publicBranchRegex: string | null } {
  return { publicBranchRegex };
}

describe("isPublicBuild", () => {
  it("returns true when build.public is set", () => {
    expect(isPublicBuild(publicTestProject(null), { public: true, gitBranch: "feature/x" })).toBe(
      true,
    );
  });

  it("returns true when the branch matches the project regex", () => {
    expect(
      isPublicBuild(publicTestProject("^main$|^main$"), { public: false, gitBranch: "main" }),
    ).toBe(true);
  });

  it("returns false when no regex is configured", () => {
    expect(isPublicBuild(publicTestProject(null), { public: false, gitBranch: "main" })).toBe(
      false,
    );
  });

  it("returns false when the branch does not match the regex", () => {
    expect(
      isPublicBuild(publicTestProject("^main$"), { public: false, gitBranch: "feature/x" }),
    ).toBe(false);
  });
});

async function setupApprovedDefault() {
  const { db } = makeDatabase();
  const model = new BuildModel(db, buildTables(db));
  const project = await new ProjectModel(db, projectTables(db)).create({
    name: "Test",
    gitRepository: "owner/repo",
  });
  return { model, project };
}

describe("BuildModel latestApprovedDefault", () => {
  it("returns the most recent approved build on the default branch", async () => {
    const { model, project } = await setupApprovedDefault();
    const older = await model.create(project.id, { gitSha: "a", gitBranch: "main" });
    await model.update(older.id, { status: "approved" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await model.create(project.id, { gitSha: "b", gitBranch: "main" });
    await model.update(newer.id, { status: "approved" });
    expect((await model.latestApprovedDefault(project))?.id).toBe(newer.id);
  });

  it("ignores approved builds on other branches", async () => {
    const { model, project } = await setupApprovedDefault();
    const main = await model.create(project.id, { gitSha: "a", gitBranch: "main" });
    await model.update(main.id, { status: "approved" });
    const feature = await model.create(project.id, { gitSha: "b", gitBranch: "feature/x" });
    await model.update(feature.id, { status: "approved" });
    expect((await model.latestApprovedDefault(project))?.id).toBe(main.id);
  });

  it("ignores unapproved default-branch builds", async () => {
    const { model, project } = await setupApprovedDefault();
    const approved = await model.create(project.id, { gitSha: "a", gitBranch: "main" });
    await model.update(approved.id, { status: "approved" });
    const failed = await model.create(project.id, { gitSha: "f", gitBranch: "main" });
    const reviewing = await model.create(project.id, { gitSha: "r", gitBranch: "main" });
    await model.create(project.id, { gitSha: "p", gitBranch: "main" });
    await model.update(failed.id, { status: "failed" });
    await model.update(reviewing.id, { status: "reviewing" });
    expect((await model.latestApprovedDefault(project))?.id).toBe(approved.id);
  });

  it("returns null when the default branch has no approved build", async () => {
    const { model, project } = await setupApprovedDefault();
    const feature = await model.create(project.id, { gitSha: "a", gitBranch: "feature/x" });
    await model.update(feature.id, { status: "approved" });
    expect(await model.latestApprovedDefault(project)).toBeNull();
  });
});

async function cancelled() {
  const { db } = makeDatabase();
  const model = new BuildModel(db, buildTables(db));
  const build = await model.create("p1", { gitSha: "abc", gitBranch: "main" });
  await model.setStatus(build.id, "capturing");
  await model.setStatus(build.id, "cancelled");
  return { model, id: build.id };
}

describe("BuildModel: a cancelled build is terminal", () => {
  it("refuses every later status write and returns the row as it is", async () => {
    const { model, id } = await cancelled();
    const attempts = (["capturing", "failed", "approved", "reviewing"] as const).flatMap(
      (status) => [model.setStatus(id, status), model.update(id, { status })],
    );
    const rows = await Promise.all(attempts);
    expect(rows.map((row) => row.status)).toEqual(rows.map(() => "cancelled"));
    expect((await model.get(id))?.status).toBe("cancelled");
  });

  it("still lets other fields change, and a repeated cancel through", async () => {
    const { model, id } = await cancelled();
    expect((await model.update(id, { message: "note" })).message).toBe("note");
    expect((await model.setStatus(id, "cancelled")).status).toBe("cancelled");
  });

  it("logs the refused write at debug", async () => {
    const { db } = makeDatabase();
    const debug = vi.fn();
    const model = new BuildModel(db, buildTables(db), { debug } as unknown as Logger);
    const build = await model.create("p1", { gitSha: "abc", gitBranch: "main" });
    await model.setStatus(build.id, "cancelled");
    await model.setStatus(build.id, "failed");
    expect(debug).toHaveBeenCalledWith(
      { buildId: build.id, refused: "failed" },
      "build is cancelled; status write refused",
    );
  });

  it("is left only by resetStatus (retry)", async () => {
    const { model, id } = await cancelled();
    expect((await model.resetStatus(id, "pending")).status).toBe("pending");
    expect((await model.setStatus(id, "capturing")).status).toBe("capturing");
  });
});
