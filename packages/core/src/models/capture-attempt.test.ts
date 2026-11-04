import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../adapters/database.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { CaptureAttemptModel } from "./capture-attempt.ts";
import { CaptureLogModel } from "./capture-log.ts";

function attemptTables(db: DatabaseAdapter) {
  return { captureAttempts: db.tables.captureAttempts };
}

function logTables(db: DatabaseAdapter) {
  return { captureLogs: db.tables.captureLogs };
}

describe("CaptureAttemptModel", () => {
  it("numbers attempts sequentially per build", async () => {
    const { db } = makeDatabase();
    const model = new CaptureAttemptModel(db, attemptTables(db));
    const first = await model.startAttempt("p1", "b1", "req-1");
    const second = await model.startAttempt("p1", "b1");
    expect(first.attemptNo).toBe(1);
    expect(first.status).toBe("queued");
    expect(first.reqId).toBe("req-1");
    expect(second.attemptNo).toBe(2);
  });

  it("transitions queued -> running -> completed", async () => {
    const { db } = makeDatabase();
    const model = new CaptureAttemptModel(db, attemptTables(db));
    const attempt = await model.startAttempt("p1", "b1");
    const running = await model.markRunning(attempt.id);
    expect(running.status).toBe("running");
    expect(running.startedAt).not.toBeNull();
    const done = await model.markFinished(attempt.id, "completed", undefined, {
      storyCount: 7,
      failedCount: 0,
    });
    expect(done.status).toBe("completed");
    expect(done.storyCount).toBe(7);
    expect(done.finishedAt).not.toBeNull();
  });

  it("keeps an attempt a cancel closed: a run that ends late cannot rewrite it", async () => {
    const { db } = makeDatabase();
    const model = new CaptureAttemptModel(db, attemptTables(db));
    const attempt = await model.startAttempt("p1", "b1");
    await model.markRunning(attempt.id);
    await model.closeOthers("b1", null, "Cancelled by a user");
    expect((await model.markRunning(attempt.id)).status).toBe("cancelled");
    const late = await model.markFinished(attempt.id, "completed", undefined, {
      storyCount: 3,
      failedCount: 0,
    });
    expect(late).toMatchObject({ status: "cancelled", error: "Cancelled by a user" });
    expect((await model.markFinished(attempt.id, "failed", "boom")).status).toBe("cancelled");
    expect((await model.getByNo("b1", 1))?.status).toBe("cancelled");
  });

  it("records the terminal error on failure", async () => {
    const { db } = makeDatabase();
    const model = new CaptureAttemptModel(db, attemptTables(db));
    const attempt = await model.startAttempt("p1", "b1");
    const failed = await model.markFinished(attempt.id, "failed", "boom");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("boom");
  });

  it("lists attempts in order and fetches by number", async () => {
    const { db } = makeDatabase();
    const model = new CaptureAttemptModel(db, attemptTables(db));
    await model.startAttempt("p1", "b1");
    await model.startAttempt("p1", "b1");
    const rows = await model.listByBuild("b1");
    expect(rows.map((row) => row.attemptNo)).toEqual([1, 2]);
    expect((await model.getByNo("b1", 2))?.attemptNo).toBe(2);
    expect(await model.getByNo("b1", 9)).toBeNull();
  });
});

describe("CaptureLogModel", () => {
  it("appends sequenced lines and lists them in order", async () => {
    const { db } = makeDatabase();
    const attempts = new CaptureAttemptModel(db, attemptTables(db));
    const logs = new CaptureLogModel(db, logTables(db));
    const attempt = await attempts.startAttempt("p1", "b1");
    await logs.append("p1", "b1", attempt.id, "info", "storybook extracted", { durationMs: 3 });
    await logs.append("p1", "b1", attempt.id, "error", "capture failed");
    const rows = await logs.listByAttempt(attempt.id);
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
    expect(rows[0]?.message).toBe("storybook extracted");
    expect(rows[0]?.fields).toBe(JSON.stringify({ durationMs: 3 }));
    expect(rows[1]?.level).toBe("error");
  });

  describe("closeIfOpen", () => {
    const counts = { storyCount: 7, failedCount: 2 };

    it("closes a queued or running attempt in one write and reports the row", async () => {
      const { db } = makeDatabase();
      const model = new CaptureAttemptModel(db, attemptTables(db));
      const queued = await model.startAttempt("p1", "b1");
      const running = await model.markRunning((await model.startAttempt("p1", "b1")).id);

      const closedQueued = await model.closeIfOpen(queued.id, "failed", "boom", counts);
      const closedRunning = await model.closeIfOpen(running.id, "completed", undefined, counts);

      expect(closedQueued).toMatchObject({ status: "failed", error: "boom", ...counts });
      expect(closedQueued?.finishedAt).not.toBeNull();
      expect(closedRunning).toMatchObject({ status: "completed", error: null });
    });

    it("never overwrites an attempt that is no longer open", async () => {
      const { db } = makeDatabase();
      const model = new CaptureAttemptModel(db, attemptTables(db));
      const completed = await model.startAttempt("p1", "b1");
      await model.markFinished(completed.id, "completed", undefined, counts);
      const cancelled = await model.startAttempt("p1", "b1");
      await model.markFinished(cancelled.id, "cancelled", "user");

      expect(
        await model.closeIfOpen(completed.id, "failed", "late", { storyCount: 0, failedCount: 0 }),
      ).toBeNull();
      expect(
        await model.closeIfOpen(cancelled.id, "failed", "late", { storyCount: 0, failedCount: 0 }),
      ).toBeNull();

      const rows = await model.listByBuild("b1");
      expect(rows.find((row) => row.id === completed.id)).toMatchObject({
        status: "completed",
        error: null,
        ...counts,
      });
      expect(rows.find((row) => row.id === cancelled.id)).toMatchObject({
        status: "cancelled",
        error: "user",
      });
    });

    it("answers null for an attempt that does not exist", async () => {
      const { db } = makeDatabase();
      const model = new CaptureAttemptModel(db, attemptTables(db));
      expect(await model.closeIfOpen("missing", "failed", "x", counts)).toBeNull();
    });
  });
});
