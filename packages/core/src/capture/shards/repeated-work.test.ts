import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureLogModel } from "../../models/capture-log.ts";
import { CaptureShardModel } from "../../models/capture-shard.ts";
import type { ShardTarget } from "./context.ts";
import { reportRepeatedWork } from "./repeated-work.ts";

function fakeTarget() {
  const logger = { warn: vi.fn() };
  const target = {
    options: { db: { tables: { captureShards: {} } }, tables: undefined, logger },
    build: { id: "build-1" },
    project: { id: "project-1" },
  } as unknown as ShardTarget;
  return { target, logger };
}

function stubLookup(attemptId: string | null, fails = false) {
  const plan = vi.spyOn(CaptureShardModel.prototype, "plan");
  if (fails) {
    plan.mockRejectedValue(new Error("db gone"));
  } else {
    plan.mockResolvedValue({ attemptId } as never);
  }
  return vi.spyOn(CaptureLogModel.prototype, "append").mockResolvedValue(undefined as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportRepeatedWork", () => {
  it("says nothing, and reads nothing, for a clean first run", async () => {
    const append = stubLookup("attempt-1");
    const { target, logger } = fakeTarget();
    const onRepeated = vi.fn();
    await reportRepeatedWork(target, 2, { attempt: 1, limit: 3, onRepeated }, 0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(onRepeated).not.toHaveBeenCalled();
    expect(CaptureShardModel.prototype.plan).not.toHaveBeenCalled();
  });

  it("logs, writes the attempt log and calls the hook with the delivery", async () => {
    const append = stubLookup("attempt-1");
    const { target, logger } = fakeTarget();
    const onRepeated = vi.fn();
    await reportRepeatedWork(target, 2, { attempt: 2, limit: 3, onRepeated }, 4);
    const message =
      "re-captured 4 snapshots an earlier attempt of shard 2 had already stored (attempt 2 of 3)";
    expect(logger.warn).toHaveBeenCalledWith(
      { buildId: "build-1", shard: 2, repeated: 4, attempt: 2, limit: 3 },
      message,
    );
    expect(append).toHaveBeenCalledWith("project-1", "build-1", "attempt-1", "warn", message, {
      shard: 2,
      repeated: 4,
      attempt: 2,
      limit: 3,
    });
    expect(onRepeated).toHaveBeenCalledWith({ repeated: 4, attempt: 2, limit: 3 });
  });

  it("says snapshot in the singular and leaves out a delivery the queue did not report", async () => {
    stubLookup("attempt-1");
    const { target, logger } = fakeTarget();
    const onRepeated = vi.fn();
    await reportRepeatedWork(target, 0, { onRepeated }, 1);
    expect(logger.warn).toHaveBeenCalledWith(
      { buildId: "build-1", shard: 0, repeated: 1 },
      "re-captured 1 snapshot an earlier attempt of shard 0 had already stored",
    );
    expect(onRepeated).toHaveBeenCalledWith({ repeated: 1 });
  });

  it("writes no attempt-log line when the build has no plan attempt", async () => {
    const append = stubLookup(null);
    const { target, logger } = fakeTarget();
    await reportRepeatedWork(target, 1, {}, 2);
    expect(append).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("carries on when the plan lookup fails, and still calls the hook", async () => {
    const append = stubLookup(null, true);
    const { target, logger } = fakeTarget();
    const onRepeated = vi.fn();
    await expect(reportRepeatedWork(target, 1, { onRepeated }, 2)).resolves.toBeUndefined();
    expect(append).not.toHaveBeenCalled();
    expect(onRepeated).toHaveBeenCalledWith({ repeated: 2 });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("carries on when the attempt-log write fails or the hook throws", async () => {
    const append = stubLookup("attempt-1");
    append.mockRejectedValue(new Error("write failed"));
    const { target } = fakeTarget();
    const onRepeated = vi.fn(() => {
      throw new Error("hook broke");
    });
    await expect(reportRepeatedWork(target, 1, { onRepeated }, 2)).resolves.toBeUndefined();
    expect(onRepeated).toHaveBeenCalledTimes(1);
  });
});
