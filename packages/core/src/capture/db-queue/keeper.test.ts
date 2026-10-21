import { describe, expect, it, vi } from "vitest";
import type { LeaseRenewal, PollableJob } from "../../adapters/capture-queue.ts";
import { createManualClock } from "../../test-helpers/manual-clock.ts";
import { CANCEL_CHECK_MS } from "./cadence.ts";
import { keepJobLease, RENEW_THROTTLE_MS } from "./keeper.ts";

const job: PollableJob = { buildId: "b1", receipt: "j:1", leaseMs: 300_000 };

function fakeQueue(extendResult: LeaseRenewal = "ok", inspectResult: LeaseRenewal = "ok") {
  const state = { extend: extendResult, inspect: inspectResult };
  const queue = {
    extend: vi.fn(async () => state.extend),
    inspect: vi.fn(async () => state.inspect),
  };
  return { queue, state };
}

describe("keepJobLease", () => {
  it("renews only on progress, at most once per throttle interval", async () => {
    const clock = createManualClock();
    const { queue } = fakeQueue();
    const keeper = keepJobLease(queue, job, { now: clock.now, timers: clock.timers });
    keeper.touch();
    expect(queue.extend).not.toHaveBeenCalled();
    await clock.advance(RENEW_THROTTLE_MS);
    // Time alone never renews: a hung run must lose its lease.
    expect(queue.extend).not.toHaveBeenCalled();
    keeper.touch();
    keeper.touch();
    await clock.flush();
    expect(queue.extend).toHaveBeenCalledTimes(1);
    keeper.touch();
    expect(queue.extend).toHaveBeenCalledTimes(1);
    keeper.stop();
    keeper.stop();
  });

  it("derives the throttle from a short lease", async () => {
    const clock = createManualClock();
    const { queue } = fakeQueue();
    const keeper = keepJobLease(
      queue,
      { ...job, leaseMs: 900 },
      { now: clock.now, timers: clock.timers },
    );
    await clock.advance(300);
    keeper.touch();
    await clock.flush();
    expect(queue.extend).toHaveBeenCalledTimes(1);
    keeper.stop();
  });

  it("ends with lost when a renewal reports it", async () => {
    const clock = createManualClock();
    const { queue } = fakeQueue("lost");
    const keeper = keepJobLease(queue, job, {
      now: clock.now,
      timers: clock.timers,
      renewEveryMs: 1,
    });
    await clock.advance(1);
    keeper.touch();
    await expect(keeper.ended).resolves.toBe("lost");
    await clock.flush();
    expect(clock.pending).toBe(0);
  });

  it("checks the job every 5 s without renewing, and ends on cancel", async () => {
    const clock = createManualClock();
    const { queue, state } = fakeQueue();
    const keeper = keepJobLease(queue, job, { now: clock.now, timers: clock.timers });
    await clock.advance(CANCEL_CHECK_MS * 3);
    expect(queue.inspect).toHaveBeenCalledTimes(3);
    expect(queue.extend).not.toHaveBeenCalled();
    state.inspect = "cancelled";
    await clock.advance(CANCEL_CHECK_MS);
    await expect(keeper.ended).resolves.toBe("cancelled");
    await clock.advance(CANCEL_CHECK_MS * 3);
    expect(queue.inspect).toHaveBeenCalledTimes(4);
  });

  it("treats a failing renewal or check as transient and warns once", async () => {
    const clock = createManualClock();
    const warn = vi.fn();
    const queue = {
      extend: vi.fn(async (): Promise<LeaseRenewal> => {
        throw new Error("db blip");
      }),
      inspect: vi.fn(async (): Promise<LeaseRenewal> => {
        throw new Error("db blip");
      }),
    };
    const keeper = keepJobLease(queue, job, {
      now: clock.now,
      timers: clock.timers,
      renewEveryMs: 1,
      logger: { warn } as never,
    });
    await clock.advance(CANCEL_CHECK_MS * 2);
    keeper.touch();
    await clock.flush();
    expect(warn).toHaveBeenCalledTimes(1);
    const ended = vi.fn();
    keeper.ended.then(ended).catch(() => {});
    await clock.flush();
    expect(ended).not.toHaveBeenCalled();
    keeper.stop();
  });

  it("does nothing for a queue without extend or inspect", async () => {
    const clock = createManualClock();
    const keeper = keepJobLease({}, job, { now: clock.now, timers: clock.timers, renewEveryMs: 1 });
    await clock.advance(CANCEL_CHECK_MS * 2);
    keeper.touch();
    expect(clock.pending).toBe(0);
    keeper.stop();
  });

  it("uses the real clock and timers by default", () => {
    const { queue } = fakeQueue();
    const keeper = keepJobLease(queue, { buildId: "b1" });
    keeper.touch();
    keeper.stop();
    expect(queue.extend).not.toHaveBeenCalled();
  });
});
