import { describe, expect, it } from "vitest";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { createManualClock } from "../../test-helpers/manual-clock.ts";
import { createDatabaseCaptureQueue } from "../db-queue/index.ts";
import { createCaptureConsumer } from "./index.ts";
import { stubLogger } from "./test-fixtures.ts";
import type { ConsumerJob } from "./types.ts";

describe("two consumers on one database", () => {
  it("runs every job exactly once", async () => {
    const jobsCount = 20;
    const clock = createManualClock();
    const { db } = makeDatabase();
    const ran = new Map<string, number>();
    const consumers = ["a", "b"].map((owner) => {
      const queue = createDatabaseCaptureQueue(db, {
        owner,
        now: clock.now,
        timers: clock.timers,
      });
      const consumer = createCaptureConsumer({
        queue,
        handlers: {
          capture: async (job: ConsumerJob) => {
            ran.set(job.buildId, (ran.get(job.buildId) ?? 0) + 1);
            await Promise.resolve();
          },
        },
        config: { concurrency: 3, maxRetries: 2 },
        now: clock.now,
        timers: clock.timers,
        random: () => 0,
        logger: stubLogger().logger,
      });
      return { queue, consumer, started: consumer.start() };
    });
    const [first] = consumers;
    for (let n = 0; n < jobsCount; n += 1) {
      // oxlint-disable-next-line no-await-in-loop -- ids stay in order
      await first?.queue.enqueue({ buildId: `b${String(n)}` });
    }
    await clock.advance(60_000);

    expect(ran.size).toBe(jobsCount);
    expect([...ran.values()].every((count) => count === 1)).toBe(true);
    const rows = await new CaptureJobModel(db).listRecent(["capture"], 100);
    expect(rows.every((row) => row.status === "done")).toBe(true);
    await Promise.all(consumers.map(async ({ consumer }) => await consumer.stop()));
    await Promise.all(consumers.map(async ({ started }) => await started));
  });
});
