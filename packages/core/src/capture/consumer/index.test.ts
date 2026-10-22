import { describe, expect, it, vi } from "vitest";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { gate, rig, recordingHandler } from "./test-fixtures.ts";
import type { ConsumerJob, KindHandler } from "./types.ts";

async function stateOf(r: ReturnType<typeof rig>, jobId: string) {
  return await new CaptureJobModel(r.db).get(jobId);
}

describe("createCaptureConsumer over the database queue", () => {
  it("runs each job with the handler of its kind and acks it", async () => {
    const capture = recordingHandler();
    const notify = recordingHandler();
    const r = rig({ kinds: ["capture", "notify"], handlers: { capture, notify } });
    const consumer = r.consume();
    const started = consumer.start();
    const captureId = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    const notifyId = await r.queue.enqueueJob({ kind: "notify", data: { channel: "c" } });
    await r.clock.advance(3000);

    expect(capture.jobs.map((job) => job.buildId)).toEqual(["b1"]);
    expect(notify.jobs.map((job) => job.data)).toEqual([{ channel: "c" }]);
    expect((await stateOf(r, captureId))?.status).toBe("done");
    expect((await stateOf(r, notifyId))?.status).toBe("done");
    await consumer.stop();
    await started;
  });

  it("accepts a plain function as a handler", async () => {
    const seen: string[] = [];
    const r = rig({
      handlers: {
        capture: async (job: ConsumerJob) => {
          seen.push(job.buildId);
        },
      },
    });
    const consumer = r.consume();
    const started = consumer.start();
    await r.queue.enqueue({ buildId: "b9" });
    await r.clock.advance(3000);
    expect(seen).toEqual(["b9"]);
    await consumer.stop();
    await started;
  });

  it("fails a job of a kind without a handler, with a clear error, and keeps consuming", async () => {
    const capture = recordingHandler();
    const r = rig({ kinds: ["capture", "publish"], handlers: { capture } });
    const consumer = r.consume();
    const started = consumer.start();
    const publishId = await r.queue.enqueueJob({ kind: "publish", buildId: "b1" });
    await r.clock.advance(3000);

    const row = await stateOf(r, publishId);
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe('no handler registered for job kind "publish"');
    expect(r.log.calls.some((call) => call.level === "error")).toBe(true);

    await r.queue.enqueue({ buildId: "b2" });
    await r.clock.advance(3000);
    expect(capture.jobs.map((job) => job.buildId)).toEqual(["b2"]);
    await consumer.stop();
    await started;
  });

  it("fails a malformed job without retrying it", async () => {
    const run = vi.fn(async () => {});
    const handler: KindHandler = { run, accepts: (job) => job.buildId.length > 0 };
    const r = rig({ handlers: { capture: handler } });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture" });
    await r.clock.advance(3000);
    expect(run).not.toHaveBeenCalled();
    expect(await stateOf(r, id)).toMatchObject({ status: "failed", error: "malformed job" });
    await consumer.stop();
    await started;
  });

  it("scopes its logs to the build and job, never interpolating", async () => {
    const r = rig({ handlers: { capture: recordingHandler() } });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1", reqId: "req" });
    await r.clock.advance(3000);
    expect(r.log.children).toContainEqual(
      expect.objectContaining({ buildId: "b1", jobId: id, kind: "capture", reqId: "req" }),
    );
    await consumer.stop();
    await started;
  });

  it("binds a scoped child logger on the queue", () => {
    const r = rig();
    const spy = vi.spyOn(r.queue, "setLogger");
    r.consume();
    expect(spy).toHaveBeenCalledOnce();
    expect(r.log.children).toContainEqual({ component: "database" });
  });
});

describe("concurrency slots", () => {
  it("runs at most `concurrency` jobs and does not poll while every slot is busy", async () => {
    const hold = gate();
    const handler = recordingHandler(hold.promise);
    const r = rig({ handlers: { capture: handler }, concurrency: 2 });
    const poll = vi.spyOn(r.queue, "poll");
    const consumer = r.consume();
    const started = consumer.start();
    for (const id of ["b1", "b2", "b3"]) {
      // oxlint-disable-next-line no-await-in-loop -- jobs queue in order
      await r.queue.enqueue({ buildId: id });
    }
    await r.clock.advance(1000);
    expect(handler.jobs.map((job) => job.buildId)).toEqual(["b1", "b2"]);

    const polled = poll.mock.calls.length;
    await r.clock.advance(120_000);
    expect(poll.mock.calls.length).toBe(polled);
    expect(handler.jobs).toHaveLength(2);

    hold.open();
    await r.clock.advance(3000);
    expect(handler.jobs.map((job) => job.buildId)).toEqual(["b1", "b2", "b3"]);
    await consumer.stop();
    await started;
  });
});

describe("retries", () => {
  it("requeues a failing job with exponential backoff, then completes it", async () => {
    let calls = 0;
    const r = rig({
      handlers: {
        capture: async () => {
          calls += 1;
          if (calls < 3) {
            throw new Error(`boom ${String(calls)}`);
          }
        },
      },
    });
    const consumer = r.consume();
    const started = consumer.start();
    const t0 = r.clock.now();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    expect(calls).toBe(1);
    const afterFirst = await stateOf(r, id);
    expect(afterFirst?.status).toBe("queued");
    expect(afterFirst?.visibleAt).toBe(new Date(t0 + 1000).toISOString());
    expect(afterFirst?.error).toBe("boom 1");

    // The idle poll finds the retry once its delay has passed (the active cadence is 2 s).
    await r.clock.advance(2000);
    expect(calls).toBe(2);
    const afterSecond = await stateOf(r, id);
    // The second retry waits twice as long as the first.
    expect(
      Date.parse(afterSecond?.visibleAt ?? "") - Date.parse(afterSecond?.updatedAt ?? ""),
    ).toBe(2000);

    await r.clock.advance(6000);
    expect(calls).toBe(3);
    expect((await stateOf(r, id))?.status).toBe("done");
    await consumer.stop();
    await started;
  });

  it("uses the backoff of the job's own kind when its handler states one", async () => {
    const r = rig({
      kinds: ["notify"],
      handlers: {
        notify: {
          backoff: { baseMs: 10_000, maxMs: 15_000 },
          run: async () => {
            throw new Error("boom");
          },
        },
      },
    });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "notify", buildId: "b1" });
    await r.clock.advance(100);
    const first = await stateOf(r, id);
    expect(Date.parse(first?.visibleAt ?? "") - Date.parse(first?.updatedAt ?? "")).toBe(10_000);
    await r.clock.advance(12_000);
    const second = await stateOf(r, id);
    // 20 s doubled, held at the handler's cap.
    expect(Date.parse(second?.visibleAt ?? "") - Date.parse(second?.updatedAt ?? "")).toBe(15_000);
    await consumer.stop();
    await started;
  });

  it("applies the final-attempt rule: the last attempt is nacked without requeue", async () => {
    const r = rig({
      retries: 1,
      handlers: {
        capture: async () => {
          throw new Error("always");
        },
      },
    });
    const nack = vi.spyOn(r.queue, "nack");
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(5000);

    expect(nack.mock.calls.map(([, options]) => options)).toEqual([
      { requeue: true, delayMs: 1000, error: "always" },
      { requeue: false, error: "always" },
    ]);
    expect(await stateOf(r, id)).toMatchObject({ status: "failed", error: "always" });
    await consumer.stop();
    await started;
  });

  it("fails at once when retries is 0", async () => {
    const r = rig({
      retries: 0,
      handlers: {
        capture: async () => {
          throw new Error("no retry");
        },
      },
    });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(3000);
    expect((await stateOf(r, id))?.status).toBe("failed");
    await consumer.stop();
    await started;
  });

  it("survives a handler that throws synchronously or a non-Error, and keeps consuming", async () => {
    const seen: string[] = [];
    const r = rig({
      retries: 0,
      handlers: {
        capture: (job: ConsumerJob) => {
          if (job.buildId === "sync") {
            throw new Error("sync crash");
          }
          if (job.buildId === "string") {
            return Promise.reject(new Error("rejected"));
          }
          seen.push(job.buildId);
          return Promise.resolve();
        },
      },
    });
    const consumer = r.consume();
    const started = consumer.start();
    const first = await r.queue.enqueueJob({ kind: "capture", buildId: "sync" });
    const second = await r.queue.enqueueJob({ kind: "capture", buildId: "string" });
    await r.queue.enqueue({ buildId: "ok" });
    await r.clock.advance(10_000);
    expect((await stateOf(r, first))?.error).toBe("sync crash");
    expect((await stateOf(r, second))?.error).toBe("rejected");
    expect(seen).toEqual(["ok"]);
    await consumer.stop();
    await started;
  });

  it("keeps consuming when settling a job fails", async () => {
    const seen: string[] = [];
    const r = rig({
      handlers: {
        capture: async (job: ConsumerJob) => {
          seen.push(job.buildId);
        },
      },
    });
    vi.spyOn(r.queue, "ack").mockRejectedValueOnce(new Error("db down"));
    const consumer = r.consume();
    const started = consumer.start();
    await r.queue.enqueue({ buildId: "b1" });
    await r.queue.enqueue({ buildId: "b2" });
    await r.clock.advance(10_000);
    expect(seen).toEqual(["b1", "b2"]);
    expect(r.log.calls.some((call) => call.message === "failed to settle job")).toBe(true);
    await consumer.stop();
    await started;
  });
});

describe("lease and cancel", () => {
  it("renews the lease on progress, throttled", async () => {
    const hold = gate();
    const progressRef: { touch: () => void } = { touch: () => {} };
    const r = rig({
      handlers: {
        capture: {
          run: async (_job, context) => {
            progressRef.touch = context.touch;
            await hold.promise;
          },
        },
      },
    });
    const progress = vi.fn();
    const consumer = r.consume({ onProgress: progress });
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    const attempt = `${id}:1`;
    const before = (await new CaptureJobModel(r.db).get(attempt))?.visibleAt ?? "";
    await r.clock.advance(31_000);
    progressRef.touch();
    await r.clock.flush();
    const after = (await new CaptureJobModel(r.db).get(attempt))?.visibleAt ?? "";
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ buildId: "b1" }));
    hold.open();
    await consumer.stop();
    await started;
  });

  it("stops a job whose lease was taken over: cancels the run, writes nothing, frees the slot", async () => {
    const hold = gate();
    const cancel = vi.fn(async () => {});
    const seen: string[] = [];
    const r = rig({
      handlers: {
        capture: {
          run: async (job) => {
            seen.push(job.buildId);
            if (job.buildId === "b1") {
              await hold.promise;
            }
          },
          cancel,
        },
      },
    });
    const ack = vi.spyOn(r.queue, "ack");
    const nack = vi.spyOn(r.queue, "nack");
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    // Another instance took the job over: it is on attempt 2 now.
    const now = new Date(r.clock.now()).toISOString();
    await new CaptureJobModel(r.db).markRunning(id, 2, now);
    await r.clock.advance(6000);

    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ buildId: "b1" }));
    expect(ack).not.toHaveBeenCalled();
    expect(nack).not.toHaveBeenCalled();
    await r.queue.enqueue({ buildId: "b2" });
    await r.clock.advance(3000);
    expect(seen).toEqual(["b1", "b2"]);
    hold.open();
    await consumer.stop();
    await started;
  });

  it("cancels a running job: runner stops, the job ends cancelled", async () => {
    const hold = gate();
    const cancel = vi.fn(async () => {
      hold.open();
    });
    const r = rig({
      handlers: {
        capture: {
          run: async () => {
            await hold.promise;
          },
          cancel,
        },
      },
    });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    expect(await r.queue.cancel(id)).toBe(true);
    await r.clock.advance(6000);

    expect(cancel).toHaveBeenCalledOnce();
    expect((await stateOf(r, id))?.status).toBe("cancelled");
    await consumer.stop();
    await started;
  });

  it("still ends a cancelled job when the handler's cancel throws", async () => {
    const hold = gate();
    const r = rig({
      handlers: {
        capture: {
          run: async () => {
            await hold.promise;
          },
          cancel: async () => {
            throw new Error("no runner");
          },
        },
      },
    });
    const consumer = r.consume();
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    await r.queue.cancel(id);
    await r.clock.advance(6000);
    expect((await stateOf(r, id))?.status).toBe("cancelled");
    expect(r.log.calls.some((call) => call.message === "failed to cancel the running job")).toBe(
      true,
    );
    hold.open();
    await consumer.stop();
    await started;
  });
});

describe("drain", () => {
  it("stop() waits for in-flight jobs, and start() resolves after it", async () => {
    const hold = gate();
    const handler = recordingHandler(hold.promise);
    const r = rig({ handlers: { capture: handler } });
    const consumer = r.consume();
    const started = consumer.start();
    expect(consumer.isRunning()).toBe(true);
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(100);
    expect(handler.jobs).toHaveLength(1);

    let stopped = false;
    const stopping = consumer.stop().then(() => {
      stopped = true;
    });
    await r.clock.advance(1000);
    expect(stopped).toBe(false);
    expect((await stateOf(r, id))?.status).toBe("running");

    hold.open();
    await stopping;
    await started;
    expect((await stateOf(r, id))?.status).toBe("done");
    expect(consumer.isRunning()).toBe(false);
  });

  it("takes no new job after stop()", async () => {
    const handler = recordingHandler();
    const r = rig({ handlers: { capture: handler } });
    const consumer = r.consume();
    const started = consumer.start();
    await r.clock.advance(100);
    await consumer.stop();
    await started;
    await r.queue.enqueue({ buildId: "late" });
    await r.clock.advance(60_000);
    expect(handler.jobs).toHaveLength(0);
  });

  it("start is idempotent while running and stop is safe before start", async () => {
    const r = rig({ handlers: { capture: recordingHandler() } });
    const consumer = r.consume();
    await consumer.stop();
    const first = consumer.start();
    await consumer.start();
    await consumer.stop();
    await consumer.stop();
    await first;
    expect(consumer.isRunning()).toBe(false);
  });

  it("can be started again after a stop", async () => {
    const handler = recordingHandler();
    const r = rig({ handlers: { capture: handler } });
    const consumer = r.consume();
    const first = consumer.start();
    await consumer.stop();
    await first;
    const second = consumer.start();
    await r.queue.enqueue({ buildId: "again" });
    await r.clock.advance(3000);
    expect(handler.jobs.map((job) => job.buildId)).toEqual(["again"]);
    await consumer.stop();
    await second;
  });
});

describe("metrics hooks", () => {
  it("reports how each job ended and samples the queue's depth and oldest job", async () => {
    const hold = gate();
    const finished: { kind: string; outcome: string; attempt: number }[] = [];
    const samples: { depth: number; running: number; oldestAgeMs: number }[] = [];
    const r = rig({
      retries: 0,
      handlers: {
        capture: async (job: ConsumerJob) => {
          if (job.buildId === "bad") {
            throw new Error("bad");
          }
          if (job.buildId === "held") {
            await hold.promise;
          }
        },
      },
    });
    const consumer = r.consume({
      metrics: {
        jobFinished: (event) => {
          finished.push(event);
        },
        queueSample: (sample) => {
          samples.push(sample);
        },
        sampleEveryMs: 10_000,
      },
    });
    const started = consumer.start();
    await r.queue.enqueue({ buildId: "held" });
    await r.clock.advance(100);
    await r.queue.enqueue({ buildId: "waiting" });
    await r.clock.advance(10_000);
    expect(samples.at(-1)).toMatchObject({ depth: 1, running: 1 });
    expect(samples.at(-1)?.oldestAgeMs).toBeGreaterThan(0);
    hold.open();
    await r.queue.enqueue({ buildId: "bad" });
    await r.clock.advance(5000);
    const outcomes = finished.map((event) => event.outcome);
    expect(outcomes).toHaveLength(3);
    expect(outcomes.filter((outcome) => outcome === "completed")).toHaveLength(2);
    expect(outcomes).toContain("failed");
    await consumer.stop();
    await started;
  });

  it("is not disturbed by a throwing hook", async () => {
    const r = rig({ handlers: { capture: recordingHandler() } });
    const consumer = r.consume({
      metrics: {
        jobFinished: () => {
          throw new Error("hook");
        },
      },
    });
    const started = consumer.start();
    const id = await r.queue.enqueueJob({ kind: "capture", buildId: "b1" });
    await r.clock.advance(3000);
    expect((await stateOf(r, id))?.status).toBe("done");
    await consumer.stop();
    await started;
  });
});
