import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { createShelfLogger } from "../logger.ts";
import { BuildModel } from "../models/build.ts";
import { CaptureAttemptModel } from "../models/capture-attempt.ts";
import { ProjectModel } from "../models/project.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import type { DispatchDeps } from "./dispatch.ts";
import { INTERRUPTED_ERROR, recoverStuckCaptures } from "./recovery.ts";

function tables(db: DatabaseAdapter) {
  return {
    projects: db.tables.projects,
    builds: db.tables.builds,
    buildLabels: db.tables.buildLabels,
    snapshots: db.tables.snapshots,
    baselines: db.tables.baselines,
    projectStatusConfigs: db.tables.projectStatusConfigs,
    captureAttempts: db.tables.captureAttempts,
    captureLogs: db.tables.captureLogs,
  };
}

async function setup() {
  const { db } = makeDatabase();
  const project = await new ProjectModel(db, tables(db)).create({ name: "Recover" });
  const builds = new BuildModel(db, tables(db));
  const attempts = new CaptureAttemptModel(db, tables(db));
  const enqueue = vi.fn(async (_buildId: string) => {});
  const deps = {
    db,
    tables: tables(db),
    gitHosts: [],
    secret: undefined,
    logger: createShelfLogger({ level: "silent" }),
  } as unknown as DispatchDeps;
  const recover = async () => await recoverStuckCaptures({ deps, enqueue });
  const stuckBuild = async (sha: string) => {
    const build = await builds.create(project.id, { gitSha: sha, gitBranch: "feature/x" });
    await builds.setStatus(build.id, "capturing");
    return build;
  };
  const runningAttempt = async (buildId: string) => {
    const attempt = await attempts.startAttempt(project.id, buildId);
    return await attempts.markRunning(attempt.id);
  };
  return { project, builds, attempts, enqueue, recover, stuckBuild, runningAttempt };
}

describe("recoverStuckCaptures", () => {
  it("requeues an interrupted build once and closes its open attempt", async () => {
    const { builds, attempts, enqueue, recover, stuckBuild, runningAttempt } = await setup();
    const build = await stuckBuild("sha-1");
    await runningAttempt(build.id);

    const result = await recover();

    expect(result).toEqual({ requeued: [build.id], failed: [] });
    expect(enqueue).toHaveBeenCalledWith(build.id);
    expect((await builds.get(build.id))?.status).toBe("pending");
    const [attempt] = await attempts.listByBuild(build.id);
    expect(attempt?.status).toBe("failed");
    expect(attempt?.error).toBe(INTERRUPTED_ERROR);
  });

  it("fails a build interrupted again after a recovery requeue (crash loop guard)", async () => {
    const { builds, enqueue, recover, stuckBuild, runningAttempt } = await setup();
    const build = await stuckBuild("sha-2");
    await runningAttempt(build.id);
    await recover();
    // The requeued run starts and is interrupted by another restart.
    await builds.setStatus(build.id, "capturing");
    await runningAttempt(build.id);
    enqueue.mockClear();

    const result = await recover();

    expect(result).toEqual({ requeued: [], failed: [build.id] });
    expect(enqueue).not.toHaveBeenCalled();
    expect((await builds.get(build.id))?.status).toBe("failed");
  });

  it("allows another requeue after a manual retry that finished normally", async () => {
    const { builds, attempts, enqueue, recover, stuckBuild, runningAttempt } = await setup();
    const build = await stuckBuild("sha-3");
    await runningAttempt(build.id);
    await recover();
    const [first] = await attempts.listByBuild(build.id);
    expect(first?.error).toBe(INTERRUPTED_ERROR);
    const second = await runningAttempt(build.id);
    await attempts.markFinished(second.id, "completed");
    await builds.setStatus(build.id, "capturing");
    await runningAttempt(build.id);
    enqueue.mockClear();

    const result = await recover();

    expect(result.requeued).toEqual([build.id]);
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("requeues a stuck build that has no attempt rows", async () => {
    const { enqueue, recover, stuckBuild } = await setup();
    const build = await stuckBuild("sha-4");

    const result = await recover();

    expect(result.requeued).toEqual([build.id]);
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("leaves builds in other states alone and does nothing without stuck builds", async () => {
    const { project, builds, enqueue, recover } = await setup();
    const pending = await builds.create(project.id, { gitSha: "sha-5", gitBranch: "main" });

    const result = await recover();

    expect(result).toEqual({ requeued: [], failed: [] });
    expect(enqueue).not.toHaveBeenCalled();
    expect((await builds.get(pending.id))?.status).toBe("pending");
  });
});
