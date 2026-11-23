import { describe, expect, it } from "vitest";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { createDatabaseCaptureQueue } from "./index.ts";
import { attemptRef, MAX_NACK_DELAY_MS } from "./poll.ts";

function setUp(retries = 2) {
  const { db } = makeDatabase();
  const clock = { now: Date.parse("2026-01-01T00:00:00.000Z") };
  const queue = createDatabaseCaptureQueue(db, { retries, now: () => clock.now });
  return { db, clock, queue };
}

describe("ack / nack", () => {
  it("clamps a nack delay into [0, 1 h]", async () => {
    const { clock, queue } = setUp();
    await queue.enqueue({ buildId: "b1" });
    await queue.nack((await queue.poll())!, { delayMs: 10 * MAX_NACK_DELAY_MS });
    clock.now += MAX_NACK_DELAY_MS - 1;
    expect(await queue.poll()).toBeNull();
    clock.now += 1;
    const again = await queue.poll();
    await queue.nack(again!, { delayMs: -50 });
    expect((await queue.poll())?.attempt).toBe(3);
  });

  it("requeues by default and fails with a generic error when none is given", async () => {
    const { queue } = setUp(0);
    await queue.enqueue({ buildId: "b1" });
    await queue.nack((await queue.poll())!);
    expect(await queue.status("b1")).toMatchObject({ status: "failed", error: "failed" });
  });

  it("ends a cancelled job as cancelled on nack, whatever the requeue flag", async () => {
    const { queue } = setUp();
    await queue.enqueue({ buildId: "b1" });
    const job = await queue.poll();
    await queue.cancel("b1");
    await queue.nack(job!, { requeue: true, error: "stopped" });
    expect(await queue.status("b1")).toMatchObject({ status: "cancelled", error: "stopped" });
  });

  it("keeps a cancelled job cancelled when its run finishes anyway", async () => {
    const { queue } = setUp();
    await queue.enqueue({ buildId: "b1" });
    const job = await queue.poll();
    await queue.cancel("b1");
    await queue.nack(job!, { requeue: false });
    await queue.ack(job!);
    expect((await queue.status("b1"))?.status).toBe("cancelled");
  });

  it("ignores a second nack of the same attempt", async () => {
    const { queue } = setUp();
    await queue.enqueue({ buildId: "b1" });
    const job = await queue.poll();
    await queue.nack(job!, { requeue: true, delayMs: 5000 });
    await queue.nack(job!, { requeue: false, error: "late" });
    expect((await queue.status("b1"))?.status).toBe("queued");
  });

  it("rejects jobs that did not come from this queue", async () => {
    const { queue } = setUp();
    await expect(queue.ack({ buildId: "b1" })).rejects.toThrow(/receipt/u);
    await expect(queue.nack({ buildId: "b1", receipt: "nope" })).rejects.toThrow(/receipt/u);
    expect(() => attemptRef({ buildId: "b1", receipt: "j:0" })).toThrow(/receipt/u);
    expect(attemptRef({ buildId: "b1", receipt: "j:3" })).toEqual({
      receipt: "j:3",
      jobId: "j",
      attempt: 3,
    });
  });
});
