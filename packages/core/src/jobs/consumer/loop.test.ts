import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "../../test-helpers/manual-clock.ts";
import { startSlotLoop } from "./loop.ts";
import { gate, stubLogger } from "./test-fixtures.ts";
import type { ConsumerJob } from "./types.ts";

function fakeQueue(jobs: ConsumerJob[]) {
  const poll = vi.fn(async () => jobs.shift() ?? null);
  return { queue: { poll } as never, poll };
}

describe("startSlotLoop", () => {
  it("takes a slot before polling and does not poll while every slot is busy", async () => {
    const clock = createManualClock();
    const hold = gate();
    const { queue, poll } = fakeQueue([{ buildId: "a" }, { buildId: "b" }, { buildId: "c" }]);
    const run = vi.fn(async () => {
      await hold.promise;
    });
    const loop = startSlotLoop({
      queue,
      slots: 2,
      waitMs: 0,
      run,
      logger: stubLogger().logger,
      now: clock.now,
      timers: clock.timers,
    });
    await clock.flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(loop.busy).toBe(2);
    await clock.advance(60_000);
    expect(poll).toHaveBeenCalledTimes(2);

    hold.open();
    await clock.flush();
    expect(run).toHaveBeenCalledTimes(3);
    await loop.stop();
  });

  it("backs off instead of spinning on a queue that returns empty at once", async () => {
    const clock = createManualClock();
    const { queue, poll } = fakeQueue([]);
    const loop = startSlotLoop({
      queue,
      slots: 1,
      waitMs: 0,
      run: async () => {},
      logger: stubLogger().logger,
      now: clock.now,
      timers: clock.timers,
    });
    await clock.flush();
    expect(poll).toHaveBeenCalledTimes(1);
    await clock.advance(250);
    expect(poll).toHaveBeenCalledTimes(2);
    await clock.advance(500);
    expect(poll).toHaveBeenCalledTimes(3);
    // A poll parked on the queue ends when its wait does; stop() waits for that.
    const stopping = loop.stop();
    await clock.advance(20_000);
    await stopping;
  });

  it("adds no sleep for a queue that blocks inside poll", async () => {
    const clock = createManualClock();
    const poll = vi.fn(async () => {
      // A long poll: parked on the queue until the wait elapses.
      await new Promise<void>((resolve) => {
        clock.timers.setTimeout(resolve, 20_000);
      });
      return null;
    });
    const loop = startSlotLoop({
      queue: { poll } as never,
      slots: 1,
      waitMs: 20_000,
      run: async () => {},
      logger: stubLogger().logger,
      now: clock.now,
      timers: clock.timers,
    });
    await clock.advance(20_000);
    expect(poll).toHaveBeenCalledTimes(2);
    await clock.advance(20_000);
    expect(poll).toHaveBeenCalledTimes(3);
    // A poll parked on the queue ends when its wait does; stop() waits for that.
    const stopping = loop.stop();
    await clock.advance(20_000);
    await stopping;
  });

  it("logs a failed poll, pauses, and continues", async () => {
    const clock = createManualClock();
    const log = stubLogger();
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new Error("sqs down"))
      .mockResolvedValueOnce({ buildId: "ok" })
      .mockResolvedValue(null);
    const run = vi.fn(async () => {});
    const loop = startSlotLoop({
      queue: { poll } as never,
      slots: 1,
      waitMs: 0,
      run,
      logger: log.logger,
      now: clock.now,
      timers: clock.timers,
    });
    await clock.flush();
    expect(run).not.toHaveBeenCalled();
    await clock.advance(1000);
    expect(run).toHaveBeenCalled();
    expect(log.calls.some((call) => call.message === "poll failed")).toBe(true);
    await loop.stop();
  });

  it("stops promptly while sleeping in a backoff, and survives a rejecting run", async () => {
    const clock = createManualClock();
    const log = stubLogger();
    const { queue } = fakeQueue([{ buildId: "x" }]);
    const loop = startSlotLoop({
      queue,
      slots: 1,
      waitMs: 0,
      run: async () => {
        throw new Error("run crashed");
      },
      logger: log.logger,
      now: clock.now,
      timers: clock.timers,
    });
    await clock.flush();
    await loop.stop();
    expect(log.calls.some((call) => call.message === "job run failed")).toBe(true);
    expect(clock.pending).toBe(0);
  });
});
