import { describe, expect, it } from "vitest";
import { captureAttempts, captureLogs } from "../../../db-sqlite/src/schema/index.ts";
import { makeDatabase } from "../test-helpers/fake-adapters.ts";
import { CaptureAttemptModel } from "./capture-attempt.ts";
import { CaptureLogModel } from "./capture-log.ts";

function attemptTables() {
  return { captureAttempts: captureAttempts as unknown as never };
}

function logTables() {
  return { captureLogs: captureLogs as unknown as never };
}

describe("CaptureAttemptModel", () => {
  it("numbers attempts sequentially per build", async () => {
    const { db } = makeDatabase();
    const model = new CaptureAttemptModel(db, attemptTables());
    const first = await model.startAttempt("p1", "b1", "req-1");
    const second = await model.startAttempt("p1", "b1");
    expect(first.attemptNo).toBe(1);
    expect(first.status).toBe("queued");
    expect(first.reqId).toBe("req-1");
    expect(second.attemptNo).toBe(2);
  });

  it("transitions queued -> running -> completed", async () => {
    const { db } = makeDatabase();
    const model = new CaptureAttemptModel(db, attemptTables());
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

  it("records the terminal error on failure", async () => {
    const { db } = makeDatabase();
    const model = new CaptureAttemptModel(db, attemptTables());
    const attempt = await model.startAttempt("p1", "b1");
    const failed = await model.markFinished(attempt.id, "failed", "boom");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("boom");
  });

  it("lists attempts in order and fetches by number", async () => {
    const { db } = makeDatabase();
    const model = new CaptureAttemptModel(db, attemptTables());
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
    const attempts = new CaptureAttemptModel(db, attemptTables());
    const logs = new CaptureLogModel(db, logTables());
    const attempt = await attempts.startAttempt("p1", "b1");
    await logs.append("p1", "b1", attempt.id, "info", "storybook extracted", { durationMs: 3 });
    await logs.append("p1", "b1", attempt.id, "error", "capture failed");
    const rows = await logs.listByAttempt(attempt.id);
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
    expect(rows[0]?.message).toBe("storybook extracted");
    expect(rows[0]?.fields).toBe(JSON.stringify({ durationMs: 3 }));
    expect(rows[1]?.level).toBe("error");
  });
});
