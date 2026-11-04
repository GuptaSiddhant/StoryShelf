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
  return { model, project, db };
}

describe("BuildModel latestApprovedDefault", () => {
  it("returns the most recent approved build on the default branch", async () => {
    const { model, project, db } = await setupApprovedDefault();
    const older = await model.create(project.id, { gitSha: "a", gitBranch: "main" });
    await model.update(older.id, { status: "approved" });
    await db.update(db.tables.builds, older.id, {
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = await model.create(project.id, { gitSha: "b", gitBranch: "main" });
    await model.update(newer.id, { status: "approved" });
    await db.update(db.tables.builds, newer.id, {
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
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

  it("refuses a status write when cancellation wins before its atomic update", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const build = await model.create("p1", { gitSha: "abc", gitBranch: "main" });
    const updateWhere = db.updateWhere.bind(db);
    let proceed!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    db.updateWhere = async (...args) => {
      entered();
      await paused;
      return await updateWhere(...args);
    };
    const late = model.setStatus(build.id, "capturing");
    await started;
    await model.setStatus(build.id, "cancelled");
    proceed();
    expect((await late).status).toBe("cancelled");
    expect((await model.get(build.id))?.status).toBe("cancelled");
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

  it("stamps the capture job that owns a build, and a reset clears it", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const { id } = await model.create(project.id, { gitSha: "abc", gitBranch: "main" });

    await model.stampCaptureJob(id, "J1", 0);
    expect((await model.get(id))?.captureJobId).toBe("J1");
    await model.resetStatus(id, "pending");
    expect((await model.get(id))?.captureJobId).toBeNull();
  });

  it("advances the run generation on reset and refuses a stamp from an older one", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const { id } = await model.create(project.id, { gitSha: "abc", gitBranch: "main" });
    expect((await model.get(id))?.captureGeneration).toBe(0);

    await model.resetStatus(id, "pending");
    expect((await model.get(id))?.captureGeneration).toBe(1);
    expect(await model.stampCaptureJob(id, "OLD", 0)).toEqual({ result: "stale" });
    expect((await model.get(id))?.captureJobId ?? null).toBeNull();
    expect(await model.stampCaptureJob(id, "NEW", 1)).toEqual({ result: "stamped", generation: 2 });
    expect((await model.get(id))?.captureJobId).toBe("NEW");
    expect(await model.stampCaptureJob("missing", "J", 0)).toEqual({ result: "ignored" });
  });

  it("retries a reset that lost the generation race to another reset", async () => {
    const { db } = makeDatabase();
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const model = new BuildModel(db, buildTables(db));
    const { id } = await model.create(project.id, { gitSha: "abc", gitBranch: "main" });
    // Another reset lands between this one's read and its write, once.
    const rival = new BuildModel(db, buildTables(db));
    const racing = Object.create(db) as typeof db;
    let raced = false;
    racing.updateWhere = async (table, rowId, values, where) => {
      if (!raced) {
        raced = true;
        await rival.resetStatus(rowId, "pending");
      }
      return await db.updateWhere(table, rowId, values, where);
    };
    const reset = await new BuildModel(racing, buildTables(db)).resetStatus(id, "pending");

    expect(reset.captureGeneration).toBe(2);
    expect((await model.get(id))?.captureGeneration).toBe(2);
  });

  it("gives up after repeatedly losing the generation race", async () => {
    const { db } = makeDatabase();
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const { id } = await new BuildModel(db, buildTables(db)).create(project.id, {
      gitSha: "abc",
      gitBranch: "main",
    });
    const rival = new BuildModel(db, buildTables(db));
    const racing = Object.create(db) as typeof db;
    racing.updateWhere = async (table, rowId, values, where) => {
      await rival.resetStatus(rowId, "pending");
      return await db.updateWhere(table, rowId, values, where);
    };

    await expect(
      new BuildModel(racing, buildTables(db)).resetStatus(id, "pending"),
    ).rejects.toThrow("lost the race");
  });

  for (const verdict of ["approved", "rejected"] as const) {
    it(`starts the next review cycle when a reset reopens a ${verdict} build`, async () => {
      const { db } = makeDatabase();
      const model = new BuildModel(db, buildTables(db));
      const project = await new ProjectModel(db, projectTables(db)).create({
        name: "Test",
        gitRepository: "owner/repo",
      });
      const { id } = await model.create(project.id, { gitSha: verdict, gitBranch: "main" });
      await model.update(id, { status: verdict });
      const before = await model.get(id);

      const reset = await model.resetStatus(id, "pending");

      expect(reset.status).toBe("pending");
      expect(reset.reviewCycle).toBe((before?.reviewCycle ?? 0) + 1);
      expect(reset.captureGeneration).toBe((before?.captureGeneration ?? 0) + 1);
      expect(reset.captureJobId ?? null).toBeNull();
    });
  }

  it("leaves the review cycle alone when a reset reopens a build with no verdict", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const { id } = await model.create(project.id, { gitSha: "abc", gitBranch: "main" });
    await model.update(id, { status: "failed" });
    const before = await model.get(id);

    const reset = await model.resetStatus(id, "pending");

    expect(reset.reviewCycle).toBe(before?.reviewCycle);
    expect(reset.captureGeneration).toBe((before?.captureGeneration ?? 0) + 1);
  });

  it("reopens the review cycle of a verdict that lands between a reset's read and its write", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const { id } = await model.create(project.id, { gitSha: "abc", gitBranch: "main" });
    await model.update(id, { status: "failed" });
    const before = await model.get(id);
    // The verdict is written once, right before the reset's first write.
    const racing = Object.create(db) as typeof db;
    let verdictLanded = false;
    racing.updateWhere = async (table, rowId, values, where) => {
      if (!verdictLanded) {
        verdictLanded = true;
        await model.update(rowId, { status: "approved" });
      }
      return await db.updateWhere(table, rowId, values, where);
    };

    const reset = await new BuildModel(racing, buildTables(db)).resetStatus(id, "pending");

    expect(verdictLanded).toBe(true);
    expect(reset.status).toBe("pending");
    expect(reset.reviewCycle).toBe((before?.reviewCycle ?? 0) + 1);
    expect(reset.captureGeneration).toBe((before?.captureGeneration ?? 0) + 1);
  });

  it("does not stamp a cancelled build", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const { id } = await model.create(project.id, { gitSha: "abc", gitBranch: "main" });
    await model.setStatus(id, "cancelled");

    await model.stampCaptureJob(id, "J1", 0);

    expect((await model.get(id))?.captureJobId ?? null).toBeNull();
  });

  it("sets a status only at the run generation it was read at, and never on a cancelled build", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const { id } = await model.create(project.id, { gitSha: "abc", gitBranch: "main" });
    await model.setStatus(id, "capturing");

    await model.resetStatus(id, "pending");
    const old = await model.setStatusAtGeneration(id, "approved", 0);
    expect(old.applied).toBe(false);
    expect((await model.get(id))?.status).toBe("pending");

    expect((await model.setStatusAtGeneration(id, "approved", 1)).applied).toBe(true);
    expect((await model.get(id))?.status).toBe("approved");

    await model.setStatus(id, "cancelled");
    expect((await model.setStatusAtGeneration(id, "approved", 1)).applied).toBe(false);
    expect((await model.get(id))?.status).toBe("cancelled");
  });

  it("fails a build only for the job that owns it", async () => {
    const { db } = makeDatabase();
    const model = new BuildModel(db, buildTables(db));
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const { id } = await model.create(project.id, { gitSha: "abc", gitBranch: "main" });
    await model.stampCaptureJob(id, "J2", 0);

    const stale = await model.failIfOwnedBy(id, "J1");
    expect(stale.applied).toBe(false);
    expect(stale.build?.status).toBe("pending");

    const owner = await model.failIfOwnedBy(id, "J2");
    expect(owner.applied).toBe(true);
    expect((await model.get(id))?.status).toBe("failed");
    expect((await model.failIfOwnedBy(id, "J2")).applied).toBe(false);
  });

  it("does not take another job's failed row for its own write, even with an equal stamp", async () => {
    const { db } = makeDatabase();
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const plain = new BuildModel(db, buildTables(db));
    const { id } = await plain.create(project.id, { gitSha: "abc", gitBranch: "main" });
    await plain.stampCaptureJob(id, "J2", 0);
    // J2 failed the build in the same millisecond J1 stamped its write: the refused update of
    // J1 returns J2's row, whose updatedAt equals J1's stamp.
    const sameInstant: DatabaseAdapter = {
      ...db,
      updateWhere: async (table, rowId, values) => ({
        ...(await db.get(table, rowId)),
        status: "failed",
        updatedAt: (values as { updatedAt: string }).updatedAt,
      }),
    } as DatabaseAdapter;
    const model = new BuildModel(sameInstant, buildTables(db));

    const stale = await model.failIfOwnedBy(id, "J1");

    expect(stale.applied).toBe(false);
    expect(stale.build?.captureJobId).toBe("J2");
  });

  it("fails a build only while it is pending, and says whether its own write applied", async () => {
    const { db } = makeDatabase();
    const project = await new ProjectModel(db, projectTables(db)).create({
      name: "Test",
      gitRepository: "owner/repo",
    });
    const model = new BuildModel(db, buildTables(db));
    const { id } = await model.create(project.id, { gitSha: "abc", gitBranch: "main" });

    const first = await model.failIfPending(id);
    expect(first.applied).toBe(true);
    expect(first.build?.status).toBe("failed");
    // Already failed: a second call changes nothing and does not claim the write.
    expect((await model.failIfPending(id)).applied).toBe(false);
  });

  it.each(["cancelled", "approved", "capturing"] as const)(
    "leaves a %s build as it is when failIfPending finds it past pending",
    async (status) => {
      const { db } = makeDatabase();
      const project = await new ProjectModel(db, projectTables(db)).create({
        name: "Test",
        gitRepository: "owner/repo",
      });
      const model = new BuildModel(db, buildTables(db));
      const { id } = await model.create(project.id, { gitSha: "abc", gitBranch: "main" });
      await model.resetStatus(id, status);

      const refused = await model.failIfPending(id);

      expect(refused.applied).toBe(false);
      expect(refused.build?.status).toBe(status);
    },
  );

  it("is left only by resetStatus (retry)", async () => {
    const { model, id } = await cancelled();
    expect((await model.resetStatus(id, "pending")).status).toBe("pending");
    expect((await model.setStatus(id, "capturing")).status).toBe("capturing");
  });
});
