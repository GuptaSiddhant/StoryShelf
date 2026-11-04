import { describe, expect, it, vi } from "vitest";
import type { CaptureRunner } from "../../adapters/capture-runner.ts";
import { BuildModel } from "../../models/build.ts";
import { CaptureAttemptModel } from "../../models/capture-attempt.ts";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { CaptureLogModel } from "../../models/capture-log.ts";
import { ProjectModel } from "../../models/project.ts";
import { makeDatabase, makeStorage } from "../../test-helpers/fake-adapters.ts";
import { captureDispatchDeps, createCaptureHandler } from "./capture-handler.ts";
import { rig, stubLogger } from "./test-fixtures.ts";

function runner(): CaptureRunner {
  return {
    metadata: { name: "r", version: "0", kind: "mock", category: "capture-runner" },
    render: vi.fn(async () => ({ captures: [], failures: [] })),
    cancel: vi.fn(async () => {}),
  } as unknown as CaptureRunner;
}

function handlerOptions() {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  return {
    db,
    storage,
    runner: runner(),
    scratchDir: ".tmp/handler-test",
    logger: stubLogger().logger,
    enqueue: async () => {},
  };
}

describe("createCaptureHandler", () => {
  it("accepts only jobs that name a build", () => {
    const handler = createCaptureHandler(handlerOptions());
    expect(handler.accepts?.({ buildId: "b1" })).toBe(true);
    expect(handler.accepts?.({ buildId: "" })).toBe(false);
  });

  it("cancels the render of the build, or of just the shard", async () => {
    const options = handlerOptions();
    const handler = createCaptureHandler(options);
    await handler.cancel?.({ buildId: "b1" });
    await handler.cancel?.({ buildId: "b1", shard: "s1" });
    expect(vi.mocked(options.runner.cancel).mock.calls[0]?.[0]).toBe("b1");
    expect(vi.mocked(options.runner.cancel).mock.calls[0]?.[1]).toBeUndefined();
    expect(options.runner.cancel).toHaveBeenNthCalledWith(2, "b1", "s1");
  });

  it("hands the shard-repeated hook to the dispatch it runs, and nothing when there is none", () => {
    const options = handlerOptions();
    const onShardRepeated = vi.fn();
    expect(captureDispatchDeps({ ...options, onShardRepeated }, 2).onShardRepeated).toBe(
      onShardRepeated,
    );
    expect(captureDispatchDeps(options, 2)).not.toHaveProperty("onShardRepeated");
  });

  it("runs the core dispatch: a job for an unknown build fails with the dispatch's error", async () => {
    const options = handlerOptions();
    const handler = createCaptureHandler(options);
    await expect(
      handler.run(
        { buildId: "ghost", attempts: 0 },
        { logger: options.logger, touch: () => {}, signal: new AbortController().signal },
      ),
    ).rejects.toThrow("Build not found: ghost");
  });
});

describe("capture jobs through the consumer", () => {
  it("fails a job for an unknown build once its attempts are used, with the dispatch error", async () => {
    const options = handlerOptions();
    const r = rig({ db: options.db, retries: 1 });
    const consumer = r.consume({
      capture: { ...options },
      config: { concurrency: 1, maxRetries: 1, backoffMs: 1000 },
    });
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "ghost" });
    await r.clock.advance(10_000);
    expect(await new CaptureJobModel(r.db).get(id)).toMatchObject({
      status: "failed",
      error: "Build not found: ghost",
    });
    await consumer.stop();
    await started;
  });
});

async function queuedBuild() {
  const options = handlerOptions();
  const project = await new ProjectModel(options.db).create({ name: "P", gitRepository: "o/r" });
  const builds = new BuildModel(options.db);
  const build = await builds.create(project.id, { gitSha: "abc", gitBranch: "main" });
  return { options, builds, build };
}

describe("a capture job queued for a superseded run", () => {
  it("is recognised by its generation, and only for a build's own job", async () => {
    const { options, builds, build } = await queuedBuild();
    const { superseded } = createCaptureHandler(options);
    const job = { buildId: build.id, data: { generation: 1 } };
    await builds.stampCaptureJob(build.id, "J1", 0);
    expect(await superseded?.(job)).toBe(false);
    await builds.resetStatus(build.id, "pending");
    expect(await superseded?.(job)).toBe(true);
    // No generation (queued before the fence) and shard jobs are never judged here.
    expect(await superseded?.({ buildId: build.id })).toBe(false);
    expect(await superseded?.({ ...job, shard: "s1" })).toBe(false);
    expect(await superseded?.({ buildId: "ghost", data: { generation: 1 } })).toBe(true);
  });

  it("is skipped by the handler itself, for a job that waited in a forked child's queue", async () => {
    const { options, builds, build } = await queuedBuild();
    await builds.stampCaptureJob(build.id, "J1", 0);
    const job = { buildId: build.id, jobId: "J1", data: { generation: 1 } };
    await builds.resetStatus(build.id, "pending");
    const before = await builds.get(build.id);
    const attempts = await options.db.list(options.db.tables.captureAttempts);

    await createCaptureHandler(options).run(job, { logger: options.logger, touch: () => {} });

    expect(options.runner.render).not.toHaveBeenCalled();
    expect(await builds.get(build.id)).toEqual(before);
    expect(await options.db.list(options.db.tables.captureAttempts)).toEqual(attempts);
  });

  it("ends cancelled before the run, with no build write", async () => {
    const { options, builds, build } = await queuedBuild();
    const r = rig({ db: options.db, retries: 1 });
    const queued = r.queue.enqueue({ buildId: build.id });
    await queued;
    // A retry starts a newer run before any worker claims the job.
    await builds.resetStatus(build.id, "pending");
    const before = await builds.get(build.id);
    const consumer = r.consume({ capture: { ...options } });
    const started = consumer.start();
    await r.clock.advance(10_000);
    const [job] = await new CaptureJobModel(r.db).listForBuild(build.id);
    expect(job?.status).toBe("cancelled");
    expect(options.runner.render).not.toHaveBeenCalled();
    expect(await builds.get(build.id)).toEqual(before);
    await consumer.stop();
    await started;
  });
});

describe("a capture job that passed its deadline", () => {
  it("records `job deadline exceeded` in the log of the build's open attempt", async () => {
    const options = handlerOptions();
    const project = await new ProjectModel(options.db).create({ name: "P", gitRepository: "o/r" });
    const build = await new BuildModel(options.db).create(project.id, {
      gitSha: "abc",
      gitBranch: "main",
    });
    const attempt = await new CaptureAttemptModel(options.db).startAttempt(project.id, build.id);
    await new CaptureAttemptModel(options.db).markRunning(attempt.id);

    await createCaptureHandler(options).deadlineExceeded?.({ buildId: build.id }, 7200);

    const logs = await new CaptureLogModel(options.db).listByAttempt(attempt.id);
    expect(logs.map((log) => [log.level, log.message])).toEqual([
      ["error", "job deadline exceeded (7200s)"],
    ]);
  });

  it("writes nothing for a build without an open attempt", async () => {
    const options = handlerOptions();
    await createCaptureHandler(options).deadlineExceeded?.({ buildId: "ghost" }, 60);
    expect(await options.db.list(options.db.tables.captureLogs)).toEqual([]);
  });
});
