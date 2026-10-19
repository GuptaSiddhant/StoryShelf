import type { RecoveryDeps } from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import { BuildModel, CaptureAttemptModel, ProjectModel } from "@storyshelf/core/models";
import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { createStalledHandler } from "./stalled-capture.ts";

async function setup(status: "capturing" | "failed" = "capturing") {
  const { db } = makeDatabase();
  const tables = {
    projects: db.tables.projects,
    builds: db.tables.builds,
    buildLabels: db.tables.buildLabels,
    snapshots: db.tables.snapshots,
    baselines: db.tables.baselines,
    projectStatusConfigs: db.tables.projectStatusConfigs,
    captureAttempts: db.tables.captureAttempts,
    captureLogs: db.tables.captureLogs,
  };
  const project = await new ProjectModel(db, tables).create({ name: "Stalled" });
  const builds = new BuildModel(db, tables);
  const build = await builds.create(project.id, { gitSha: "sha", gitBranch: "feature/x" });
  await builds.setStatus(build.id, status);
  const attempt = await new CaptureAttemptModel(db, tables).startAttempt(project.id, build.id);
  await new CaptureAttemptModel(db, tables).markRunning(attempt.id);
  const enqueue = vi.fn(async (_buildId: string) => {});
  const logger = createShelfLogger({ level: "silent" });
  const recovery = {
    deps: { db, tables, gitHosts: [], secret: undefined, logger },
    enqueue,
  } as unknown as RecoveryDeps;
  return { builds, build, enqueue, logger, recovery };
}

describe("createStalledHandler", () => {
  it("cancels the render and requeues a build still capturing after the grace period", async () => {
    const { builds, build, enqueue, logger, recovery } = await setup();
    const cancel = vi.fn(async (_buildId: string) => {});
    const handler = createStalledHandler({ runner: { cancel }, recovery, logger, graceMs: 20 });

    await handler({ buildId: build.id }, { settled: new Promise<void>(() => {}) });

    expect(cancel).toHaveBeenCalledWith(build.id);
    expect(enqueue).toHaveBeenCalledWith(build.id);
    expect((await builds.get(build.id))?.status).toBe("pending");
  });

  it("leaves a build alone when the cancelled run unwound and failed it by itself", async () => {
    const { builds, build, enqueue, logger, recovery } = await setup();
    const handler = createStalledHandler({
      runner: {
        cancel: async () => {
          await builds.setStatus(build.id, "failed");
        },
      },
      recovery,
      logger,
      graceMs: 1000,
    });

    await handler({ buildId: build.id }, { settled: Promise.resolve() });

    expect(enqueue).not.toHaveBeenCalled();
    expect((await builds.get(build.id))?.status).toBe("failed");
  });

  it("still recovers when cancelling the runner throws", async () => {
    const { build, enqueue, logger, recovery } = await setup();
    const handler = createStalledHandler({
      runner: {
        cancel: async () => {
          throw new Error("no browser");
        },
      },
      recovery,
      logger,
      graceMs: 10,
    });

    await handler({ buildId: build.id }, { settled: new Promise<void>(() => {}) });

    expect(enqueue).toHaveBeenCalledWith(build.id);
  });

  it("does not wait out the grace period once the run settles", async () => {
    const { build, logger, recovery } = await setup();
    const handler = createStalledHandler({
      runner: { cancel: async () => {} },
      recovery,
      logger,
      graceMs: 60_000,
    });
    const started = Date.now();

    await handler({ buildId: build.id }, { settled: Promise.resolve() });

    expect(Date.now() - started).toBeLessThan(5000);
  });
});
