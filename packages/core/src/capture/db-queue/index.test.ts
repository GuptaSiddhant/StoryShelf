import { describe, expect, it } from "vitest";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { queueContractSuite } from "../../test-helpers/queue-contract.ts";
import { createDatabaseCaptureQueue } from "./index.ts";

const clock = { now: Date.parse("2026-01-01T00:00:00.000Z") };

queueContractSuite(
  "database (fake db)",
  () =>
    createDatabaseCaptureQueue(makeDatabase().db, {
      leaseMs: 60_000,
      retries: 2,
      now: () => clock.now,
    }),
  {
    pollable: {
      advance: (ms) => {
        clock.now += ms;
      },
      leaseMs: 60_000,
      retries: 2,
    },
  },
);

describe("createDatabaseCaptureQueue", () => {
  it("names itself the database capture queue", () => {
    const queue = createDatabaseCaptureQueue(makeDatabase().db);
    expect(queue.metadata).toMatchObject({ kind: "database", category: "capture-queue" });
  });

  it("rejects an empty kind list and a bad retry count", () => {
    const { db } = makeDatabase();
    expect(() => createDatabaseCaptureQueue(db, { kinds: [] })).toThrow(/kinds/u);
    expect(() => createDatabaseCaptureQueue(db, { retries: -1 })).toThrow(/retries/u);
    expect(() => createDatabaseCaptureQueue(db, { retries: 1.5 })).toThrow(/retries/u);
  });

  it("falls back to the default lease for a non-positive one", async () => {
    const queue = createDatabaseCaptureQueue(makeDatabase().db, { leaseMs: 0 });
    await queue.enqueue({ buildId: "b1" });
    expect((await queue.poll())?.leaseMs).toBe(5 * 60_000);
  });

  it("keeps an explicit logger over a bound one", async () => {
    const lines: string[] = [];
    const logger = { info: (_o: unknown, msg: string) => lines.push(`explicit:${msg}`) };
    const bound = { info: (_o: unknown, msg: string) => lines.push(`bound:${msg}`) };
    const queue = createDatabaseCaptureQueue(makeDatabase().db, { logger: logger as never });
    queue.setLogger?.(bound as never);
    await queue.enqueue({ buildId: "b1" });
    expect(lines).toEqual(["explicit:job queued"]);
  });

  it("uses a bound logger when none was given", async () => {
    const lines: string[] = [];
    const queue = createDatabaseCaptureQueue(makeDatabase().db);
    queue.setLogger?.({ info: (_o: unknown, msg: string) => lines.push(msg) } as never);
    await queue.enqueue({ buildId: "b1" });
    expect(lines).toEqual(["job queued"]);
  });

  it("enqueues every kind but polls only its own", async () => {
    const { db } = makeDatabase();
    const capture = createDatabaseCaptureQueue(db);
    const publish = createDatabaseCaptureQueue(db, { kinds: ["publish", "notify"] });
    await publish.enqueueJob({ kind: "notify", data: { channelId: "c1" } });
    expect(await capture.poll()).toBeNull();
    const job = await publish.poll();
    expect(job).toMatchObject({ kind: "notify", buildId: "", data: { channelId: "c1" } });
  });
});
