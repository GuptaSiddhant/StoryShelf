import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRunner } from "../adapters/capture-runner.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { createShelfLogger } from "../logger.ts";
import { BuildModel } from "../models/build.ts";
import { CaptureAttemptModel } from "../models/capture-attempt.ts";
import { CaptureShardModel } from "../models/capture-shard.ts";
import { NotificationChannelModel } from "../models/notification-channel.ts";
import { ProjectModel } from "../models/project.ts";
import { makeDatabase, makeStorage } from "../test-helpers/fake-adapters.ts";
import { makeFakeStateNotifier } from "../test-helpers/fake-notifier.ts";
import { storybookZipPath } from "../utils/paths.ts";
import { createBuildStatePublisher } from "./build-state/publisher.ts";
import { failCrashedCapture } from "./crash-failure.ts";
import type { DispatchDeps } from "./dispatch.ts";
import { executeCaptureJob, type ShardJob } from "./orchestrator.ts";
import { executeCaptureShard } from "./shards/execute.ts";
import { reduceBuild } from "./shards/reduce.ts";

// Counts the calls; the real reduction still runs.
vi.mock("./shards/reduce.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shards/reduce.ts")>();
  return { ...original, reduceBuild: vi.fn(original.reduceBuild) };
});

const SECRET = "test-secret-0123456789abcdef";

function tables(db: DatabaseAdapter) {
  return {
    projects: db.tables.projects,
    builds: db.tables.builds,
    buildLabels: db.tables.buildLabels,
    snapshots: db.tables.snapshots,
    baselines: db.tables.baselines,
    notificationChannels: db.tables.notificationChannels,
    captureAttempts: db.tables.captureAttempts,
    captureLogs: db.tables.captureLogs,
  };
}

function zipOfStories(count: number): Buffer {
  const entries = Object.fromEntries(
    Array.from({ length: count }, (_unused, index) => {
      const id = `button--story-${String(index).padStart(2, "0")}`;
      const entry = { id, name: id, title: "Button", importPath: "./B.stories.tsx", type: "story" };
      return [id, entry];
    }),
  );
  const zip = new AdmZip();
  zip.addFile("index.json", Buffer.from(JSON.stringify({ v: 4, entries })));
  return zip.toBuffer();
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const runner: CaptureRunner = {
  metadata: { name: "Fake", version: "0.0.0", kind: "fake", category: "capture-runner" },
  cancel: async () => {},
  render: async (input) => {
    for (const story of input.stories) {
      // oxlint-disable-next-line no-await-in-loop -- one capture at a time
      await input.onCapture?.({
        story,
        viewportName: "desktop",
        viewport: { name: "desktop", width: 1280, height: 720 },
        screenshot: Buffer.concat([PNG_SIGNATURE, Buffer.from(story.id)]),
      });
    }
    return { captures: [], failures: [] };
  },
};

let scratchDir: string;
beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "storyshelf-crash-"));
});
afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

async function world(stories = 1) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const project = await new ProjectModel(db, tables(db)).create({ name: "Crash" });
  const builds = new BuildModel(db, tables(db));
  const build = await builds.create(project.id, { gitSha: "sha-1", gitBranch: "feature/x" });
  await storage.write(storybookZipPath(project.id, build.id), zipOfStories(stories));
  const queued: ShardJob[] = [];
  const git = makeFakeStateNotifier();
  await new NotificationChannelModel(db, tables(db), SECRET).create({
    projectId: project.id,
    provider: "fake-git",
    config: {},
    secret: "ghp_token",
  });
  const deps = {
    db,
    tables: tables(db),
    jobOptions: {
      db,
      tables: tables(db),
      storage,
      runner,
      scratchDir,
      shardSize: 10,
      enqueue: async (job: ShardJob) => {
        queued.push(job);
        await Promise.resolve();
      },
    },
    buildState: createBuildStatePublisher({
      deps: {
        db,
        storage,
        notifiers: [git.provider],
        secret: SECRET,
        config: {},
        publicOrigin: async () => await Promise.resolve("https://shelf.example.com"),
        flags: () => ({ testing: true, review: false }),
        logger: createShelfLogger({ level: "silent" }),
      },
    }),
    logger: createShelfLogger({ level: "silent" }),
  } as unknown as DispatchDeps;
  const status = async () => (await builds.get(build.id))?.status;
  return { db, deps, project, builds, build, queued, status, git };
}

/** All siblings done, the crashed one last: failing it finalizes the build. */
async function lastShardCrashed() {
  const w = await world(25);
  const attempts = new CaptureAttemptModel(w.db, tables(w.db));
  const started = await attempts.startAttempt(w.project.id, w.build.id);
  await attempts.markRunning(started.id);
  await executeCaptureJob(
    {
      buildId: w.build.id,
      attempt: { id: started.id, attemptNo: started.attemptNo, projectId: w.project.id },
    },
    w.deps.jobOptions,
  );
  const [crashed, ...rest] = w.queued;
  for (const job of rest) {
    // oxlint-disable-next-line no-await-in-loop -- shards one after another
    await executeCaptureShard(job, w.deps.jobOptions);
  }
  const openAttempts = async () =>
    (await attempts.listByBuild(w.build.id)).filter(
      (attempt) => attempt.status === "queued" || attempt.status === "running",
    );
  return { w, crashed: crashed as ShardJob, attempts, openAttempts };
}

describe("failCrashedCapture", () => {
  it("fails a whole-build job and closes its open attempt", async () => {
    const w = await world();
    await w.builds.setStatus(w.build.id, "capturing");
    const attempts = new CaptureAttemptModel(w.db, tables(w.db));
    const attempt = await attempts.startAttempt(w.project.id, w.build.id);
    await attempts.markRunning(attempt.id);

    const outcome = await failCrashedCapture(w.deps, { buildId: w.build.id }, "exited 3 times");

    expect(outcome).toBe("failed");
    expect(await w.status()).toBe("failed");
    const [closed] = await attempts.listByBuild(w.build.id);
    expect(closed).toMatchObject({ status: "failed", error: "exited 3 times" });
  });

  it("shows the failure on the project's git channel", async () => {
    const w = await world();
    await w.builds.setStatus(w.build.id, "capturing");

    await failCrashedCapture(w.deps, { buildId: w.build.id }, "exited 3 times");

    expect(
      w.git.calls.map((call) => [
        call.target.kind === "status" ? call.target.context : call.target.kind,
        call.state,
      ]),
    ).toEqual([
      ["storyshelf/testing", "failure"],
      ["storyshelf/storybook", "failure"],
      ["comment", "failure"],
    ]);
  });

  it("leaves a build that already ended alone", async () => {
    const w = await world();
    await w.builds.setStatus(w.build.id, "approved");
    expect(await failCrashedCapture(w.deps, { buildId: w.build.id }, "boom")).toBe("skipped");
    expect(await w.status()).toBe("approved");
  });

  it("fails the shard and leaves the build to its open siblings", async () => {
    const w = await world(25);
    await executeCaptureJob({ buildId: w.build.id }, w.deps.jobOptions);
    const [crashed] = w.queued;

    const outcome = await failCrashedCapture(w.deps, crashed as ShardJob, "exited 3 times");

    expect(outcome).toBe("shard-failed");
    const row = await new CaptureShardModel(w.db).get(crashed?.shard ?? "");
    expect(row).toMatchObject({ status: "failed", error: "exited 3 times" });
    expect(await w.status()).toBe("capturing");
  });

  it("finalizes the build when the crashed shard was the last one open", async () => {
    const w = await world(25);
    await executeCaptureJob({ buildId: w.build.id }, w.deps.jobOptions);
    const [crashed, ...rest] = w.queued;
    for (const job of rest) {
      // oxlint-disable-next-line no-await-in-loop -- shards one after another
      await executeCaptureShard(job, w.deps.jobOptions);
    }
    expect(await w.status()).toBe("capturing");

    const outcome = await failCrashedCapture(w.deps, crashed as ShardJob, "exited 3 times");

    expect(outcome).toBe("finalized");
    expect(await w.status()).toBe("failed");
  });
  describe("a crashed shard whose build was already finalized", () => {
    it("closes the attempt on retry, without finalizing the build again", async () => {
      const { w, crashed, attempts, openAttempts } = await lastShardCrashed();
      // The close step fails once, after `reduceBuild` finalized the build.
      const close = vi
        .spyOn(CaptureAttemptModel.prototype, "markFinished")
        .mockRejectedValueOnce(new Error("database went away"));
      await expect(failCrashedCapture(w.deps, crashed, "exited 3 times")).rejects.toThrow(
        "database went away",
      );
      close.mockRestore();
      expect(await w.status()).toBe("failed");
      expect(await openAttempts()).toHaveLength(1);
      const finalizedAt = (await w.builds.get(w.build.id))?.updatedAt;
      vi.mocked(reduceBuild).mockClear();

      const outcome = await failCrashedCapture(w.deps, crashed, "exited 3 times");

      expect(outcome).toBe("finalized");
      expect(await openAttempts()).toHaveLength(0);
      const [closed] = await attempts.listByBuild(w.build.id);
      expect(closed).toMatchObject({ status: "failed", error: "exited 3 times" });
      expect(await w.status()).toBe("failed");
      expect((await w.builds.get(w.build.id))?.updatedAt).toBe(finalizedAt);
      expect(reduceBuild).not.toHaveBeenCalled();
    });

    it("skips when the first pass closed everything", async () => {
      const { w, crashed } = await lastShardCrashed();
      expect(await failCrashedCapture(w.deps, crashed, "exited 3 times")).toBe("finalized");
      vi.mocked(reduceBuild).mockClear();

      expect(await failCrashedCapture(w.deps, crashed, "exited 3 times")).toBe("skipped");
      expect(reduceBuild).not.toHaveBeenCalled();
    });

    it("leaves a newer run's attempt alone when the hook arrives after a retry", async () => {
      const { w, crashed, openAttempts } = await lastShardCrashed();
      await w.builds.setStatus(w.build.id, "approved");
      // A retry cleared the plan's rows; its new plan and attempt belong to the newer run.
      await new CaptureShardModel(w.db).clearBuild(w.build.id);

      expect(await failCrashedCapture(w.deps, crashed, "exited 3 times")).toBe("skipped");
      expect(await openAttempts()).toHaveLength(1);
    });
  });

  it("fails the build its job still owns", async () => {
    const w = await world();
    await w.builds.setStatus(w.build.id, "capturing");
    await w.builds.stampCaptureJob(w.build.id, "J1", 0);

    const outcome = await failCrashedCapture(
      w.deps,
      { buildId: w.build.id, jobId: "J1" },
      "lease exhausted",
    );

    expect(outcome).toBe("failed");
    expect(await w.status()).toBe("failed");
  });

  it("leaves a rerun alone when the hook of the run that ended arrives late", async () => {
    const w = await world();
    await w.builds.setStatus(w.build.id, "capturing");
    await w.builds.stampCaptureJob(w.build.id, "J1", 0);
    // J1 exhausted; the build is retried and queued again as J2 before J1's hook runs.
    await w.builds.resetStatus(w.build.id, "pending");
    await w.builds.stampCaptureJob(w.build.id, "J2", 1);
    await w.builds.setStatus(w.build.id, "capturing");

    const outcome = await failCrashedCapture(
      w.deps,
      { buildId: w.build.id, jobId: "J1" },
      "lease exhausted",
    );

    expect(outcome).toBe("skipped");
    expect(await w.status()).toBe("capturing");
    expect((await w.builds.get(w.build.id))?.captureJobId).toBe("J2");
    expect(w.git.calls).toEqual([]);
  });

  it("never fails a build no run owns", async () => {
    const w = await world();
    await w.builds.setStatus(w.build.id, "capturing");

    const outcome = await failCrashedCapture(
      w.deps,
      { buildId: w.build.id, jobId: "J1" },
      "lease exhausted",
    );

    expect(outcome).toBe("skipped");
    expect(await w.status()).toBe("capturing");
  });

  it("reports one failure when the hook runs twice with nothing left to clean up", async () => {
    const w = await world();
    await w.builds.setStatus(w.build.id, "capturing");
    await w.builds.stampCaptureJob(w.build.id, "J1", 0);
    const job = { buildId: w.build.id, jobId: "J1" };

    expect(await failCrashedCapture(w.deps, job, "lease exhausted")).toBe("failed");
    expect(await failCrashedCapture(w.deps, job, "lease exhausted")).toBe("skipped");
  });

  it("leaves open an attempt a newer run began after this run failed the build", async () => {
    const w = await world();
    await w.builds.setStatus(w.build.id, "capturing");
    await w.builds.stampCaptureJob(w.build.id, "J1", 0);
    const { build: failed } = await w.builds.failIfOwnedBy(w.build.id, "J1");
    const attempts = new CaptureAttemptModel(w.db, tables(w.db));
    const newer = await attempts.startAttempt(w.project.id, w.build.id);
    // Begun after the build failed: an explicit time, so the order does not depend on the clock.
    await w.db.update(tables(w.db).captureAttempts, newer.id, {
      createdAt: new Date(Date.parse(failed?.updatedAt ?? "") + 1000).toISOString(),
    });
    await attempts.markRunning(newer.id);

    const outcome = await failCrashedCapture(
      w.deps,
      { buildId: w.build.id, jobId: "J1" },
      "lease exhausted",
    );

    expect(outcome).toBe("skipped");
    const [open] = await attempts.listByBuild(w.build.id);
    expect(open?.status).toBe("running");
  });

  it("finishes the cleanup when the first run failed the build but not its attempts", async () => {
    const w = await world();
    await w.builds.setStatus(w.build.id, "capturing");
    await w.builds.stampCaptureJob(w.build.id, "J1", 0);
    const attempts = new CaptureAttemptModel(w.db, tables(w.db));
    const attempt = await attempts.startAttempt(w.project.id, w.build.id);
    await attempts.markRunning(attempt.id);
    // The first run got as far as failing the build, then died before closing the attempt.
    await w.builds.failIfOwnedBy(w.build.id, "J1");

    const outcome = await failCrashedCapture(
      w.deps,
      { buildId: w.build.id, jobId: "J1" },
      "lease exhausted",
    );

    expect(outcome).toBe("failed");
    const [closed] = await attempts.listByBuild(w.build.id);
    expect(closed).toMatchObject({ status: "failed", error: "lease exhausted" });
  });
});
