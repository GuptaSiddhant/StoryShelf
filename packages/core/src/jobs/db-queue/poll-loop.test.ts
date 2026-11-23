import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../adapters/database.ts";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { createManualClock, type ManualClock } from "../../test-helpers/manual-clock.ts";
import { ACTIVE_POLL_MS, IDLE_POLL_MS } from "./cadence.ts";
import { createDatabaseCaptureQueue } from "./index.ts";
import { startPollLoop } from "./poll-loop.ts";
import type { DatabaseJob } from "./types.ts";

/** Every database call the queue makes, and the rows each `list` returned. */
interface Spy {
  calls: string[];
  listedRows: number[];
}

/** A `DatabaseAdapter` that records each call (ADR 0006 decision 11's acceptance test). */
function spyingDatabase(): { db: DatabaseAdapter; spy: Spy } {
  const { db: inner } = makeDatabase();
  const spy: Spy = { calls: [], listedRows: [] };
  const db = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function" || typeof property !== "string") {
        return value;
      }
      return async (...args: unknown[]) => {
        spy.calls.push(property);
        const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        if (property === "list") {
          spy.listedRows.push((result as unknown[]).length);
        }
        return result;
      };
    },
  });
  return { db, spy };
}

function setUp(clock: ManualClock, random = () => 0) {
  const { db, spy } = spyingDatabase();
  const queue = createDatabaseCaptureQueue(db, { now: clock.now, timers: clock.timers });
  const started: DatabaseJob[] = [];
  const finish = new Map<string, () => void>();
  const run = vi.fn(async (job: DatabaseJob) => {
    started.push(job);
    await new Promise<void>((resolve) => {
      finish.set(job.buildId, resolve);
    });
    await queue.ack(job);
  });
  return { db, spy, queue, started, finish, run, random };
}

describe("startPollLoop: idle-poll acceptance (ADR 0006, decision 11)", () => {
  it("probes an idle queue at most once per 15 s, and the probe reads no rows", async () => {
    const clock = createManualClock();
    const { spy, queue, run } = setUp(clock);
    const loop = startPollLoop({ queue, slots: 2, run, now: clock.now, random: () => 0 });
    const elapsed = 10 * IDLE_POLL_MS;
    await clock.advance(elapsed);
    const probes = spy.calls.filter((call) => call === "list").length;
    expect(probes).toBeLessThanOrEqual(1 + elapsed / IDLE_POLL_MS);
    expect(probes).toBeGreaterThanOrEqual(elapsed / IDLE_POLL_MS);
    expect(spy.listedRows.every((rows) => rows === 0)).toBe(true);
    // Nothing but the probe: no writes, no reads by id.
    expect(new Set(spy.calls)).toEqual(new Set(["list"]));
    await loop.stop();
  });

  it("never shortens the idle interval with jitter", async () => {
    const clock = createManualClock();
    const { spy, queue, run } = setUp(clock);
    const loop = startPollLoop({ queue, slots: 1, run, now: clock.now, random: () => 0.99 });
    await clock.advance(IDLE_POLL_MS * 4);
    expect(spy.calls.filter((call) => call === "list").length).toBeLessThanOrEqual(4);
    await loop.stop();
  });

  it("does not poll while every slot is busy", async () => {
    const clock = createManualClock();
    const { spy, queue, run, started, finish } = setUp(clock);
    const loop = startPollLoop({ queue, slots: 1, run, now: clock.now, random: () => 0 });
    await clock.flush();
    await queue.enqueue({ buildId: "b-busy" });
    await clock.flush();
    expect(started.map((job) => job.buildId)).toEqual(["b-busy"]);
    spy.calls.length = 0;
    await clock.advance(10 * IDLE_POLL_MS);
    expect(spy.calls).toEqual([]);
    finish.get("b-busy")?.();
    await clock.flush();
    expect(spy.calls).toContain("list");
    await loop.stop();
  });
});

describe("startPollLoop: dispatch", () => {
  it("dispatches a local enqueue at once, without waiting for the next poll", async () => {
    const clock = createManualClock();
    const { queue, run, started, finish } = setUp(clock);
    const loop = startPollLoop({ queue, slots: 2, run, now: clock.now, random: () => 0 });
    await clock.flush();
    await queue.enqueue({ buildId: "b-now" });
    await clock.flush();
    expect(started.map((job) => job.buildId)).toEqual(["b-now"]);
    finish.get("b-now")?.();
    await loop.stop();
    expect((await queue.status("b-now"))?.status).toBe("completed");
  });

  it("polls at the active rate after work, finding another instance's job within 2 s", async () => {
    const clock = createManualClock();
    const { db, queue, run, started, finish } = setUp(clock);
    const other = createDatabaseCaptureQueue(db, { now: clock.now, timers: clock.timers });
    const loop = startPollLoop({ queue, slots: 2, run, now: clock.now, random: () => 0 });
    await clock.flush();
    await queue.enqueue({ buildId: "b-local" });
    await clock.flush();
    finish.get("b-local")?.();
    await clock.flush();
    await other.enqueue({ buildId: "b-remote" });
    await clock.advance(ACTIVE_POLL_MS);
    expect(started.map((job) => job.buildId)).toEqual(["b-local", "b-remote"]);
    finish.get("b-remote")?.();
    await loop.stop();
  });

  it("runs up to `slots` jobs at once and waits for them on stop", async () => {
    const clock = createManualClock();
    const { queue, run, started, finish } = setUp(clock);
    await queue.enqueue({ buildId: "b1" });
    await queue.enqueue({ buildId: "b2" });
    await queue.enqueue({ buildId: "b3" });
    const loop = startPollLoop({ queue, slots: 2, run, now: clock.now, random: () => 0 });
    await clock.flush();
    expect(loop.busy).toBe(2);
    expect(started).toHaveLength(2);
    const stopped = loop.stop();
    let done = false;
    stopped
      .then(() => {
        done = true;
      })
      .catch(() => {});
    await clock.flush();
    expect(done).toBe(false);
    for (const job of started) {
      finish.get(job.buildId)?.();
    }
    await stopped;
    expect(loop.busy).toBe(0);
    expect(started).toHaveLength(2);
  });

  it("logs and survives a failing poll or run", async () => {
    const clock = createManualClock();
    const { queue } = setUp(clock);
    const warn = vi.fn();
    const error = vi.fn();
    const logger = { warn, error } as never;
    let polls = 0;
    const flaky = {
      poll: async () => {
        polls += 1;
        if (polls === 1) {
          throw new Error("db down");
        }
        return polls === 2 ? await queue.poll() : null;
      },
      waitForWork: async (ms: number) => await queue.waitForWork(ms),
    };
    await queue.enqueue({ buildId: "b-fail" });
    const loop = startPollLoop({
      queue: flaky,
      slots: 1,
      run: async () => {
        throw new Error("run broke");
      },
      now: clock.now,
      random: () => 0,
      logger,
    });
    await clock.advance(IDLE_POLL_MS);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "queue poll failed",
    );
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "queue job run failed",
    );
    await loop.stop();
  });
});
