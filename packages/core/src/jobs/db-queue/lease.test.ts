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
