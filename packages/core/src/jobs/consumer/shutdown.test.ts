import { describe, expect, it, vi } from "vitest";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { createDatabaseCaptureQueue } from "../db-queue/index.ts";
import { createCaptureConsumer } from "./index.ts";
import { HAND_BACK_RESERVE_MS, releaseAtMs } from "./shutdown.ts";
import { gate, rig, untilAborted, type Rig } from "./test-fixtures.ts";
import type { ConsumerJob } from "./types.ts";

async function stateOf(r: Rig, id: string) {
  return await new CaptureJobModel(r.db).get(id);
}

/** A handler that runs until its signal aborts (a render that stops at its next checkpoint). */
function untilStopped() {
  const runs: { buildId: string; attempt?: number; attempts?: number }[] = [];
  const cancel = vi.fn(async () => {});
  return {
    runs,
    cancel,
    handler: {
      run: async (job: ConsumerJob, context: { signal: AbortSignal }) => {
        runs.push({ buildId: job.buildId, attempt: job.attempt, attempts: job.attempts });
        await untilAborted(context.signal);
      },
      cancel,
    },
  };
}

/** Track when a promise settles, so a test can assert it is (not yet) done. */
function track(promise: Promise<unknown>): { done: boolean; settled: Promise<void> } {
  const state = { done: false, settled: Promise.resolve() };
  state.settled = promise.then(() => {
    state.done = true;
  });
  return state;
}

describe("releaseAtMs", () => {
  it("keeps a reserve before the grace ends, at most HAND_BACK_RESERVE_MS and a quarter of it", () => {
    expect(releaseAtMs(20_000)).toBe(20_000 - HAND_BACK_RESERVE_MS);
    expect(releaseAtMs(4000)).toBe(3000);
    expect(releaseAtMs(0)).toBe(0);
    expect(releaseAtMs(-5)).toBe(0);
  });
});

describe("bounded drain (stop with graceMs, #912)", () => {
  it("hands back a job still running past the grace, and resolves within the grace", async () => {
    const h = untilStopped();
    const r = rig({ handlers: { capture: h.handler } });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    expect(h.runs).toHaveLength(1);

    const stopping = track(consumer.stop({ graceMs: 10_000 }));
    await r.clock.advance(releaseAtMs(10_000) - 1);
    expect(stopping.done).toBe(false);
    expect((await stateOf(r, id))?.status).toBe("running");

    await r.clock.advance(HAND_BACK_RESERVE_MS + 1);
    expect(stopping.done).toBe(true);
    await stopping.settled;
    await started;
    expect(h.cancel).toHaveBeenCalledOnce();
    expect(await stateOf(r, id)).toMatchObject({ status: "queued", attempt: 0 });
    expect(
      r.log.calls.some((call) => call.message === "shutdown grace over; handing job back"),
    ).toBe(true);
  });

  it("redelivers a handed-back job to another instance without spending an attempt", async () => {
    const h = untilStopped();
    const r = rig({ handlers: { capture: h.handler }, retries: 0 });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    const stopping = consumer.stop({ graceMs: 5000 });
    await r.clock.advance(5000);
    await stopping;
    await started;

    // A second copy on the same database: it claims the job at once, as attempt 1 again.
    const peerQueue = createDatabaseCaptureQueue(r.db, {
      retries: 0,
      now: r.clock.now,
      timers: r.clock.timers,
    });
    const done = gate();
    const peerRuns: ConsumerJob[] = [];
    const peer = createCaptureConsumer({
      queue: peerQueue,
      handlers: {
        capture: async (job) => {
          peerRuns.push(job);
          done.open();
        },
      },
      config: { concurrency: 1, maxRetries: 0 },
      now: r.clock.now,
      timers: r.clock.timers,
      random: () => 0,
      logger: r.log.logger,
    });
    const peerStarted = peer.start();
    await r.clock.advance(100);
    await done.promise;
    expect(peerRuns.map((job) => [job.attempt, job.attempts])).toEqual([[1, 0]]);
    await r.clock.advance(100);
    // Even with no retries left, the release cost nothing: the job ran and completed.
    expect(await stateOf(r, id)).toMatchObject({ status: "done", attempt: 1 });
    await peer.stop();
    await peerStarted;
  });

  it("still ends a job cancelled during the drain as cancelled", async () => {
    const h = untilStopped();
    const r = rig({ handlers: { capture: h.handler } });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    const stopping = consumer.stop({ graceMs: 60_000 });
    await r.clock.advance(1000);
    await r.queue.cancel(id);
    await r.clock.advance(6000);
    await stopping;
    await started;
    expect((await stateOf(r, id))?.status).toBe("cancelled");
  });

  it("ends a job cancelled just before its release as cancelled, not queued", async () => {
    const h = untilStopped();
    const r = rig({ handlers: { capture: h.handler } });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    const stopping = consumer.stop({ graceMs: 4000 });
    // Asked after the last cancel check, before the release: the keeper has not seen it.
    await r.clock.advance(2500);
    await r.queue.cancel(id);
    await r.clock.advance(1500);
    await stopping;
    await started;
    expect((await stateOf(r, id))?.status).toBe("cancelled");
  });

  it("acks a job that finishes within the grace, as an unbounded drain does", async () => {
    const hold = gate();
    const r = rig({
      handlers: {
        capture: async () => {
          await hold.promise;
        },
      },
    });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    const stopping = consumer.stop({ graceMs: 30_000 });
    await r.clock.advance(1000);
    hold.open();
    await stopping;
    await started;
    expect((await stateOf(r, id))?.status).toBe("done");
  });

  it("leaves a job whose handler never stops to its lease, and still resolves within the grace", async () => {
    const r = rig({
      handlers: {
        capture: {
          run: async () => await new Promise<void>(() => {}),
          cancel: async () => await new Promise<void>(() => {}),
        },
      },
    });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    const stopping = track(consumer.stop({ graceMs: 8000 }));
    await r.clock.advance(8000);
    expect(stopping.done).toBe(true);
    await stopping.settled;
    await started;
    // The handler may still write: no other instance may claim the job before its lease ends.
    expect(await stateOf(r, id)).toMatchObject({ status: "running", attempt: 1 });
    expect(
      r.log.calls.some(
        (call) => call.message === "released job still running; leaving it to its lease",
      ),
    ).toBe(true);
  });

  it("resolves at the grace even when the hand-back stalls, and says so", async () => {
    const h = untilStopped();
    const r = rig({ handlers: { capture: h.handler } });
    r.queue.handBack = async () => await new Promise<void>(() => {});
    const consumer = r.consume();
    const started = consumer.start();
    await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    const stopping = track(consumer.stop({ graceMs: 6000 }));
    await r.clock.advance(5999);
    expect(stopping.done).toBe(false);
    await r.clock.advance(1);
    expect(stopping.done).toBe(true);
    await stopping.settled;
    await started;
    expect(
      r.log.calls.some(
        (call) =>
          call.message === "drain did not settle within the shutdown grace; stopping anyway",
      ),
    ).toBe(true);
  });
});
