import { describe, expect, it, vi } from "vitest";
import type { StateNotifierProvider } from "../../adapters/notifier/provider.ts";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { deferred } from "../../test-helpers/index.ts";
import { rig, stubLogger } from "../consumer/test-fixtures.ts";
import type { ConsumerJob } from "../consumer/types.ts";
import {
  createNotifyEnqueuer,
  createNotifyHandler,
  NOTIFY_MAX_ATTEMPTS,
  notifyExhausted,
  type NotifyFailure,
} from "./notify-job.ts";
import { statusLog, world, type World } from "./test-world.ts";

async function setup(options: { onFailed?: (failure: NotifyFailure) => Promise<void> } = {}) {
  const w = await world();
  const handler = createNotifyHandler({ deps: w.deps, ...options });
  const r = rig({ db: w.db, kinds: ["notify"], handlers: { notify: handler } });
  const enqueue = createNotifyEnqueuer(w.deps, r.queue);
  const jobs = new CaptureJobModel(w.db);
  const notifyJobs = async () =>
    (await jobs.listForBuild(w.build.id)).filter((row) => row.kind === "notify");
  return { w, r, handler, enqueue, notifyJobs };
}

async function lastError(w: World): Promise<string | null | undefined> {
  return (await w.channels.get(w.channelId))?.lastError;
}

describe("the notify job past its deadline", () => {
  it("shows nothing and records nothing once its signal is aborted, even on its last attempt", async () => {
    const onFailed = vi.fn(async () => {});
    const { w, handler } = await setup({ onFailed });
    const controller = new AbortController();
    controller.abort(new Error("job deadline exceeded"));
    const job = {
      buildId: w.build.id,
      attempt: NOTIFY_MAX_ATTEMPTS,
      maxAttempts: NOTIFY_MAX_ATTEMPTS,
      data: { channelId: w.channelId },
    } as unknown as ConsumerJob;

    await expect(
      handler.run(job, { logger: stubLogger().logger, touch: () => {}, signal: controller.signal }),
    ).rejects.toThrow("job deadline exceeded");

    expect(statusLog(w.git)).toEqual([]);
    expect(await lastError(w)).toBeNull();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("stops before the host is told when the deadline passes while the state is being read", async () => {
    const { w, handler } = await setup();
    const controller = new AbortController();
    const origin = w.deps.publicOrigin;
    w.deps.publicOrigin = async () => {
      const resolved = await origin();
      controller.abort(new Error("job deadline exceeded"));
      return resolved;
    };
    const job = {
      buildId: w.build.id,
      attempt: 1,
      maxAttempts: NOTIFY_MAX_ATTEMPTS,
      data: { channelId: w.channelId },
    } as unknown as ConsumerJob;

    await expect(
      handler.run(job, { logger: stubLogger().logger, touch: () => {}, signal: controller.signal }),
    ).rejects.toThrow("job deadline exceeded");

    expect(statusLog(w.git)).toEqual([]);
  });
});

describe("the notify job", () => {
  it("delivers the build's state as it is when the job runs, not as it was when queued", async () => {
    const { w, r, enqueue } = await setup();
    await enqueue({ channelId: w.channelId, buildId: w.build.id });
    // The build moved on while the job waited (a reordered or delayed delivery).
    await w.builds.setStatus(w.build.id, "approved");

    const consumer = r.consume();
    const started = consumer.start();
    await r.clock.advance(100);
    await consumer.stop();
    await started;

    expect(statusLog(w.git)[0]).toEqual(["storyshelf/testing", "success"]);
  });

  it("collapses a request while one is already waiting, and queues another once it ran", async () => {
    const { w, enqueue, notifyJobs, r } = await setup();
    await enqueue({ channelId: w.channelId, buildId: w.build.id });
    await enqueue({ channelId: w.channelId, buildId: w.build.id });
    expect(await notifyJobs()).toHaveLength(1);

    const other = await w.channels.create({
      projectId: w.project.id,
      provider: "fake-git",
      config: { prefix: "alt" },
      secret: "t",
    });
    await enqueue({ channelId: other.id, buildId: w.build.id });
    expect(await notifyJobs()).toHaveLength(2);

    const consumer = r.consume();
    const started = consumer.start();
    await r.clock.advance(100);
    await enqueue({ channelId: w.channelId, buildId: w.build.id });
    expect(await notifyJobs()).toHaveLength(3);
    await consumer.stop();
    await started;
  });

  it("creates one job when many requests for one channel and build arrive at once", async () => {
    const { w, enqueue, notifyJobs } = await setup();
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        await enqueue({ channelId: w.channelId, buildId: w.build.id });
      }),
    );
    const rows = await notifyJobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "queued",
      activeKey: `notify:${w.channelId}:${w.build.id}`,
    });
  });

  it("delivers the newer state when the build changes during a delivery", async () => {
    const w = await world();
    // Once only: the provider is created again for every pass, so the flag lives outside it.
    let interrupted = false;
    // The build moves on and a new request comes in while the provider write is in flight.
    const interrupting: StateNotifierProvider = {
      ...w.git.provider,
      create: (opts) => {
        const adapter = w.git.provider.create(opts);
        return {
          ...adapter,
          setState: async (input) => {
            await adapter.setState(input);
            if (!interrupted) {
              interrupted = true;
              await w.builds.setStatus(w.build.id, "approved");
              await enqueue({ channelId: w.channelId, buildId: w.build.id });
            }
          },
        };
      },
    };
    const handler = createNotifyHandler({ deps: { ...w.deps, notifiers: [interrupting] } });
    const r = rig({ db: w.db, kinds: ["notify"], handlers: { notify: handler } });
    const enqueue = createNotifyEnqueuer(w.deps, r.queue);
    const jobs = new CaptureJobModel(w.db);

    await enqueue({ channelId: w.channelId, buildId: w.build.id });
    const consumer = r.consume();
    const started = consumer.start();
    await r.clock.advance(200);
    await consumer.stop();
    await started;

    // The first pass wrote the state it read (pending); the request made meanwhile got a second pass
    // that wrote the build's newer state.
    const testing = statusLog(w.git).filter(([context]) => context === "storyshelf/testing");
    expect(testing.map(([, state]) => state)).toEqual(["pending", "success"]);
    const rows = (await jobs.listForBuild(w.build.id)).filter((row) => row.kind === "notify");
    expect(rows.map((row) => row.status)).toEqual(["done", "done"]);
    expect(rows.map((row) => row.activeKey)).toEqual([null, null]);
  });

  it("allows five attempts", async () => {
    const { w, enqueue, notifyJobs } = await setup();
    await enqueue({ channelId: w.channelId, buildId: w.build.id });
    expect((await notifyJobs())[0]?.maxAttempts).toBe(NOTIFY_MAX_ATTEMPTS);
    expect(NOTIFY_MAX_ATTEMPTS).toBe(5);
  });

  it("retries a refused status with backoff, then delivers and clears the error", async () => {
    const { w, r, enqueue, notifyJobs } = await setup();
    w.failure.message = "HTTP 502: bad gateway";
    await enqueue({ channelId: w.channelId, buildId: w.build.id });
    const consumer = r.consume();
    const started = consumer.start();
    await r.clock.advance(100);
    const [queued] = await notifyJobs();
    expect(queued?.status).toBe("queued");
    expect(Date.parse(queued?.visibleAt ?? "") - Date.parse(queued?.updatedAt ?? "")).toBe(10_000);
    // Retries do not surface as a channel error yet.
    expect(await lastError(w)).toBeNull();

    w.failure.message = null;
    await r.clock.advance(12_000);
    expect((await notifyJobs())[0]?.status).toBe("done");
    expect(statusLog(w.git).length).toBeGreaterThan(0);
    expect(await lastError(w)).toBeNull();
    await consumer.stop();
    await started;
  });

  it("clears an earlier error after a successful delivery", async () => {
    const { w, r, enqueue } = await setup();
    await w.channels.recordOutcome(w.channelId, "HTTP 401: Bad credentials");
    await enqueue({ channelId: w.channelId, buildId: w.build.id });
    const consumer = r.consume();
    const started = consumer.start();
    await r.clock.advance(100);
    expect(await lastError(w)).toBeNull();
    await consumer.stop();
    await started;
  });

  it("gives up after the last attempt: records the error on the channel and raises onFailed once", async () => {
    const onFailed = vi.fn(async () => {});
    const { w, r, enqueue, notifyJobs } = await setup({ onFailed });
    w.failure.message = "HTTP 401: Bad credentials";
    await enqueue({ channelId: w.channelId, buildId: w.build.id });
    const consumer = r.consume();
    const started = consumer.start();
    // 10 s + 20 s + 40 s + 80 s of backoff between the five attempts.
    await r.clock.advance(100);
    await r.clock.advance(12_000);
    await r.clock.advance(22_000);
    await r.clock.advance(42_000);
    expect(onFailed).not.toHaveBeenCalled();
    // The poll cadence adds up to a few seconds to each delay.
    await r.clock.advance(120_000);
    expect((await notifyJobs())[0]).toMatchObject({ status: "failed", attempt: 5 });
    expect(await lastError(w)).toBe("HTTP 401: Bad credentials");
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith({
      channelId: w.channelId,
      projectId: w.project.id,
      provider: "fake-git",
      buildId: w.build.id,
      error: "HTTP 401: Bad credentials",
    });
    await consumer.stop();
    await started;
  });

  it("surfaces nothing for a delivery that fails after its job was cancelled", async () => {
    const onFailed = vi.fn(async () => {});
    const { w, handler } = await setup({ onFailed });
    w.failure.message = "HTTP 401: Bad credentials";
    const job = {
      buildId: w.build.id,
      jobId: "n1",
      attempt: NOTIFY_MAX_ATTEMPTS,
      maxAttempts: NOTIFY_MAX_ATTEMPTS,
      data: { channelId: w.channelId },
    } as never;
    const context = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      touch: () => {},
      signal: new AbortController().signal,
    };
    const running = handler.run(job, context as never);
    await handler.cancel?.(job);
    await expect(running).rejects.toThrow("notify cancelled");
    expect(onFailed).not.toHaveBeenCalled();
    expect(await lastError(w)).toBeFalsy();
  });

  it("makes no request when the cancel lands while the job is still loading the build", async () => {
    const { w, handler } = await setup();
    const job = {
      buildId: w.build.id,
      jobId: "n3",
      attempt: 1,
      maxAttempts: NOTIFY_MAX_ATTEMPTS,
      data: { channelId: w.channelId },
    } as never;
    // The cancel arrives while the origin is resolved, after the job started and before the write.
    const origin = w.deps.publicOrigin;
    (w.deps as { publicOrigin: () => Promise<string | undefined> }).publicOrigin = async () => {
      await handler.cancel?.(job);
      return await origin();
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await expect(
      handler.run(job, { logger, touch: () => {}, signal: new AbortController().signal } as never),
    ).rejects.toThrow("notify cancelled");

    expect(statusLog(w.git)).toEqual([]);
    expect(await lastError(w)).toBeFalsy();
  });

  it("keeps a cancel for an older invocation when the job is reclaimed and starts again", async () => {
    const { w, handler } = await setup();
    const job = {
      buildId: w.build.id,
      jobId: "n5",
      attempt: 1,
      maxAttempts: NOTIFY_MAX_ATTEMPTS,
      data: { channelId: w.channelId },
    } as never;
    // The first invocation waits while its origin is resolved; later ones do not.
    const origin = w.deps.publicOrigin;
    const gate = deferred();
    const entered = deferred();
    let calls = 0;
    (w.deps as { publicOrigin: () => Promise<string | undefined> }).publicOrigin = async () => {
      calls += 1;
      if (calls === 1) {
        entered.resolve();
        await gate.promise;
      }
      return await origin();
    };
    const olderLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const newerLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const older = handler.run(job, {
      logger: olderLog,
      touch: () => {},
      signal: new AbortController().signal,
    } as never);
    await entered.promise;
    await handler.cancel?.(job);
    // The job is claimed again (its lease was lost) and starts a second invocation.
    await handler.run(job, {
      logger: newerLog,
      touch: () => {},
      signal: new AbortController().signal,
    } as never);
    const writtenByNewer = statusLog(w.git).length;
    expect(writtenByNewer).toBeGreaterThan(0);
    gate.resolve();
    await expect(older).rejects.toThrow("notify cancelled");

    // The older invocation stayed stopped: it wrote nothing more after the newer one's delivery.
    expect(statusLog(w.git)).toHaveLength(writtenByNewer);
  });

  it("a cancel for a lost attempt does not stop the reclaimed attempt that runs now", async () => {
    const { w, handler } = await setup();
    const lost = {
      buildId: w.build.id,
      jobId: "n6",
      attempt: 1,
      maxAttempts: NOTIFY_MAX_ATTEMPTS,
      data: { channelId: w.channelId },
    } as never;
    const reclaimed = { ...(lost as object), attempt: 2 } as never;
    const origin = w.deps.publicOrigin;
    const gate = deferred();
    const entered = deferred();
    (w.deps as { publicOrigin: () => Promise<string | undefined> }).publicOrigin = async () => {
      entered.resolve();
      await gate.promise;
      return await origin();
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const running = handler.run(reclaimed, {
      logger,
      touch: () => {},
      signal: new AbortController().signal,
    } as never);
    await entered.promise;
    await handler.cancel?.(lost);
    gate.resolve();
    await running;
    expect(statusLog(w.git).length).toBeGreaterThan(0);
  });

  it("writes when no cancel arrives, with the same setup", async () => {
    const { w, handler } = await setup();
    const job = {
      buildId: w.build.id,
      jobId: "n4",
      attempt: 1,
      maxAttempts: NOTIFY_MAX_ATTEMPTS,
      data: { channelId: w.channelId },
    } as never;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await handler.run(job, {
      logger,
      touch: () => {},
      signal: new AbortController().signal,
    } as never);
    expect(statusLog(w.git).length).toBeGreaterThan(0);
  });

  it("still surfaces the failure of a last attempt that was not cancelled", async () => {
    const onFailed = vi.fn(async () => {});
    const { w, handler } = await setup({ onFailed });
    w.failure.message = "HTTP 401: Bad credentials";
    const job = {
      buildId: w.build.id,
      jobId: "n2",
      attempt: NOTIFY_MAX_ATTEMPTS,
      maxAttempts: NOTIFY_MAX_ATTEMPTS,
      data: { channelId: w.channelId },
    } as never;
    const context = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      touch: () => {},
      signal: new AbortController().signal,
    };
    await expect(handler.run(job, context as never)).rejects.toThrow("Bad credentials");
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("acks a job whose build or channel is gone", async () => {
    const { w, r, enqueue, notifyJobs } = await setup();
    await w.channels.remove(w.channelId);
    await enqueue({ channelId: w.channelId, buildId: w.build.id });
    const consumer = r.consume();
    const started = consumer.start();
    await r.clock.advance(100);
    expect((await notifyJobs())[0]?.status).toBe("done");
    expect(w.git.calls).toHaveLength(0);
    await consumer.stop();
    await started;
  });

  it("refuses a job that names no channel", async () => {
    const { handler } = await setup();
    expect(handler.accepts?.({ buildId: "b1", data: {} })).toBe(false);
    expect(handler.accepts?.({ buildId: "", data: { channelId: "c" } })).toBe(false);
    expect(handler.accepts?.({ buildId: "b1", data: { channelId: "c" } })).toBe(true);
  });

  it("surfaces the failure of a last attempt that lost its lease", async () => {
    const onFailed = vi.fn(async () => {});
    const w = await world();
    await notifyExhausted({ deps: w.deps, onFailed })(
      { buildId: w.build.id, data: { channelId: w.channelId } },
      "lease lost",
    );
    expect(await lastError(w)).toBe("lease lost");
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("tolerates a failing onFailed hook", async () => {
    const w = await world();
    const warn = vi.fn();
    await notifyExhausted({
      deps: { ...w.deps, logger: { error: vi.fn(), warn } as never },
      onFailed: async () => {
        throw new Error("sys channel down");
      },
    })({ buildId: w.build.id, data: { channelId: w.channelId } }, "boom");
    expect(warn).toHaveBeenCalled();
    expect(await lastError(w)).toBe("boom");
  });
});
