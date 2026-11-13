import { describe, expect, it } from "vitest";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { createDatabaseCaptureQueue } from "./index.ts";

function setUp() {
  const { db } = makeDatabase();
  const clock = { now: Date.parse("2026-01-01T00:00:00.000Z") };
  const make = (owner: string, over = {}) =>
    createDatabaseCaptureQueue(db, { leaseMs: 1000, now: () => clock.now, owner, ...over });
  return { db, clock, make };
}

describe("extend / inspect", () => {
  it("pushes the holder's own lease out and nothing else", async () => {
    const { db, clock, make } = setUp();
    const queue = make("a");
    await queue.enqueue({ buildId: "b1" });
    const job = (await queue.poll())!;
    clock.now += 900;
    expect(await queue.extend(job)).toBe("ok");
    clock.now += 900;
    expect(await queue.poll()).toBeNull();
    const row = (await db.get(db.tables.captureJobs, job.receipt!)) as { visibleAt: string };
    expect(row.visibleAt).toBe(new Date(clock.now + 100).toISOString());
  });

  it("reports lost once another attempt finished the job", async () => {
    const { db, clock, make } = setUp();
    const [first, second] = [make("a"), make("b")];
    await first.enqueue({ buildId: "b1" });
    const stale = (await first.poll())!;
    clock.now += 1001;
    const fresh = (await second.poll())!;
    // The stale holder renews just before seeing the takeover: still lost, and its row stays out of
    // the poll's range.
    expect(await first.extend(stale)).toBe("lost");
    const retired = (await db.get(db.tables.captureJobs, stale.receipt!)) as {
      status: string;
      visibleAt: string | null;
    };
    expect(retired).toMatchObject({ status: "expired", visibleAt: null });
    await second.ack(fresh);
    expect(await second.extend(fresh)).toBe("lost");
    expect(await second.inspect(fresh)).toBe("lost");
  });

  it("reports lost for a job or attempt row that is gone", async () => {
    const { db, make } = setUp();
    const queue = make("a");
    await queue.enqueue({ buildId: "b1" });
    const job = (await queue.poll())!;
    await db.remove(db.tables.captureJobs, job.receipt!);
    expect(await queue.extend(job)).toBe("lost");
    await db.remove(db.tables.captureJobs, job.jobId);
    expect(await queue.inspect(job)).toBe("lost");
  });

  it("rejects on a transient failure instead of reporting lost", async () => {
    const { db, make } = setUp();
    const queue = make("a");
    await queue.enqueue({ buildId: "b1" });
    const job = (await queue.poll())!;
    const flaky = createDatabaseCaptureQueue(
      {
        ...db,
        update: async () => {
          throw new Error("timeout");
        },
      },
      { leaseMs: 1000 },
    );
    await expect(flaky.extend(job)).rejects.toThrow("timeout");
  });

  it("reports cancelled from the renewal write and from the job row", async () => {
    const { make } = setUp();
    const queue = make("a");
    await queue.enqueue({ buildId: "b1" });
    const job = (await queue.poll())!;
    await make("b").cancel(job.jobId);
    expect(await queue.extend(job)).toBe("cancelled");
    expect(await queue.inspect(job)).toBe("cancelled");
    await queue.nack(job, { requeue: false });
    expect(await queue.inspect(job)).toBe("cancelled");
  });
});

async function rowOf(db: ReturnType<typeof setUp>["db"], id: string) {
  return (await db.get(db.tables.captureJobs, id)) as {
    status: string;
    attempt: number;
    maxAttempts: number;
    visibleAt: string | null;
    error: string | null;
  };
}

describe("release", () => {
  it("makes the job claimable at once by another instance without spending the attempt", async () => {
    const { db, clock, make } = setUp();
    const [first, second] = [make("a", { retries: 1 }), make("b", { retries: 1 })];
    await first.enqueue({ buildId: "b1" });
    const held = (await first.poll())!;
    expect(held.attempt).toBe(1);

    await first.release(held);
    expect(await rowOf(db, held.jobId)).toMatchObject({ status: "queued", error: null });
    expect(await rowOf(db, held.receipt!)).toMatchObject({ status: "released", visibleAt: null });

    // No lease wait: the clock has not moved.
    const taken = (await second.poll())!;
    expect(taken).toMatchObject({ jobId: held.jobId, attempt: 2 });
    // The released attempt did not count: two attempts were allowed and still are.
    expect(taken.maxAttempts - taken.attempt).toBe(held.maxAttempts - held.attempt);
    await second.nack(taken, { requeue: true });
    clock.now += 1;
    const last = (await first.poll())!;
    expect(last.attempt).toBe(3);
    expect(last.maxAttempts).toBe(3);
  });

  it("ignores a late release from a superseded holder", async () => {
    const { db, clock, make } = setUp();
    const [first, second] = [make("a"), make("b")];
    await first.enqueue({ buildId: "b1" });
    const stale = (await first.poll())!;
    clock.now += 1001;
    const fresh = (await second.poll())!;

    await first.release(stale);
    expect(await rowOf(db, stale.jobId)).toMatchObject({ status: "running", attempt: 2 });
    expect(await rowOf(db, fresh.receipt!)).toMatchObject({ status: "running" });
    await second.release(fresh);
    // A second release of the same attempt does nothing more.
    const after = await rowOf(db, fresh.jobId);
    await second.release(fresh);
    expect(await rowOf(db, fresh.jobId)).toEqual(after);
  });

  it("does not hand back a cancelled or finished job", async () => {
    const { db, make } = setUp();
    const queue = make("a");
    const id = await queue.enqueueJob({ kind: "capture", buildId: "b1" });
    const held = (await queue.poll())!;
    await queue.cancel(id);
    await queue.release(held);
    expect(await rowOf(db, id)).toMatchObject({ status: "running" });
    await queue.nack(held, { requeue: false });
    expect(await rowOf(db, id)).toMatchObject({ status: "cancelled" });

    await queue.enqueue({ buildId: "b2" });
    const done = (await queue.poll())!;
    await queue.ack(done);
    await queue.release(done);
    expect(await rowOf(db, done.jobId)).toMatchObject({ status: "done" });
  });

  it("leaves the holder's lease alone once released: it reads lost", async () => {
    const { make } = setUp();
    const queue = make("a");
    await queue.enqueue({ buildId: "b1" });
    const held = (await queue.poll())!;
    await queue.release(held);
    expect(await queue.extend(held)).toBe("lost");
  });
});
