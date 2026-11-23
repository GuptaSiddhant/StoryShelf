/** The capture consumer over the database queue on node:sqlite: real timers, a short cadence. */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { createCaptureConsumer, createDatabaseCaptureQueue } from "@storyshelf/core/capture";
import { createShelfLogger } from "@storyshelf/core/logger";
import { describe, expect, it, vi } from "vitest";
import { createSqliteDatabase } from "./index.ts";

const silent = createShelfLogger({ level: "silent" });
const cadence = { idleMs: 20, activeMs: 10, activeWindowMs: 1000, jitter: 0 };

async function freshDatabase(): Promise<DatabaseAdapter> {
  const db = createSqliteDatabase(":memory:");
  await db.lifecycle?.setup({ config: {}, logger: silent });
  return db;
}

describe("capture consumer on node:sqlite", () => {
  it("two consumers on one database run every job exactly once", async () => {
    const db = await freshDatabase();
    const ran = new Map<string, number>();
    const make = (owner: string) => {
      const queue = createDatabaseCaptureQueue(db, { owner });
      const consumer = createCaptureConsumer({
        queue,
        cadence,
        logger: silent,
        config: { concurrency: 3 },
        handlers: {
          capture: async (job) => {
            ran.set(job.buildId, (ran.get(job.buildId) ?? 0) + 1);
            await new Promise((resolve) => setTimeout(resolve, 5));
          },
        },
      });
      return { queue, consumer, started: consumer.start() };
    };
    const [a, b] = [make("a"), make("b")] as const;
    const total = 30;
    for (let n = 0; n < total; n += 1) {
      // oxlint-disable-next-line no-await-in-loop -- ids stay in order
      await a.queue.enqueue({ buildId: `b${String(n)}` });
    }
    await vi.waitFor(
      async () => {
        expect(ran.size).toBe(total);
        expect(await a.queue.active()).toHaveLength(0);
      },
      { timeout: 10_000 },
    );
    expect([...ran.values()].every((count) => count === 1)).toBe(true);
    await Promise.all([a.consumer.stop(), b.consumer.stop()]);
    await Promise.all([a.started, b.started]);
  });

  it("retries a failing job and ends it failed after its attempts", async () => {
    const db = await freshDatabase();
    const queue = createDatabaseCaptureQueue(db, { retries: 1 });
    let calls = 0;
    const consumer = createCaptureConsumer({
      queue,
      cadence,
      logger: silent,
      config: { concurrency: 1, maxRetries: 1, backoffMs: 10 },
      handlers: {
        capture: async () => {
          calls += 1;
          throw new Error("nope");
        },
      },
    });
    const started = consumer.start();
    await queue.enqueue({ buildId: "b1" });
    await vi.waitFor(
      async () => {
        expect((await queue.recent(5))[0]?.status).toBe("failed");
      },
      { timeout: 10_000 },
    );
    expect(calls).toBe(2);
    await consumer.stop();
    await started;
  });
});
