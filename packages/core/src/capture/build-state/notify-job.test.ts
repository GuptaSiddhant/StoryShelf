import { describe, expect, it, vi } from "vitest";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { rig } from "../consumer/test-fixtures.ts";
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
