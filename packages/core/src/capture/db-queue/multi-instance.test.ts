import { describe, expect, it, vi } from "vitest";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { createManualClock } from "../../test-helpers/manual-clock.ts";
import { databaseQueueMultiInstanceSuite } from "../../test-helpers/queue-multi-instance.ts";
import { CANCEL_CHECK_MS } from "./cadence.ts";
import { createDatabaseCaptureQueue } from "./index.ts";
import { keepJobLease } from "./keeper.ts";

databaseQueueMultiInstanceSuite("fake database", () => makeDatabase().db);

describe("cancel and takeover reach the holder (manual clock)", () => {
  it("reaches the holder of a hung job within the cancel check interval", async () => {
    const clock = createManualClock();
    const { db } = makeDatabase();
    const options = { now: clock.now, timers: clock.timers };
    const holder = createDatabaseCaptureQueue(db, { ...options, owner: "holder" });
    const canceller = createDatabaseCaptureQueue(db, { ...options, owner: "canceller" });
    await canceller.enqueue({ buildId: "b-hung" });
    const job = (await holder.poll())!;
    // The run is hung: it never touches the lease; only the keeper's check timer runs.
    const keeper = keepJobLease(holder, job, options);
    const ended = vi.fn();
    keeper.ended.then(ended).catch(() => {});
    await clock.advance(CANCEL_CHECK_MS * 2);
    expect(ended).not.toHaveBeenCalled();
    await canceller.cancel("b-hung");
    await clock.advance(CANCEL_CHECK_MS);
    expect(ended).toHaveBeenCalledWith("cancelled");
    expect(clock.pending).toBe(0);
  });

  it("tells the stale holder of a taken-over job that it lost, within the interval", async () => {
    const clock = createManualClock();
    const { db } = makeDatabase();
    const options = { leaseMs: 60_000, now: clock.now, timers: clock.timers };
    const first = createDatabaseCaptureQueue(db, { ...options, owner: "first" });
    const second = createDatabaseCaptureQueue(db, { ...options, owner: "second" });
    await first.enqueue({ buildId: "b-taken" });
    const job = (await first.poll())!;
    const keeper = keepJobLease(first, job, options);
    await clock.advance(60_001);
    expect((await second.poll())?.attempt).toBe(2);
    await clock.advance(CANCEL_CHECK_MS);
    await expect(keeper.ended).resolves.toBe("lost");
  });
});
