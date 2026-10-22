import { describe, expect, it } from "vitest";
import type { CaptureJobRow } from "../../schema/capture-job.ts";
import { decodePayload, encodePayload, toDatabaseJob, toQueueEntry } from "./codec.ts";

const row: CaptureJobRow = {
  id: "j1",
  entry: "job",
  jobId: "j1",
  kind: "capture",
  buildId: "b1",
  shardId: null,
  attempt: 0,
  maxAttempts: 3,
  status: "queued",
  visibleAt: "t0",
  owner: null,
  payload: null,
  cancelRequestedAt: null,
  error: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "t0",
  updatedAt: "t0",
};

describe("payload codec", () => {
  it("round-trips request id, trace context and data", () => {
    const encoded = encodePayload({
      kind: "notify",
      reqId: "r1",
      traceparent: "00-a-b-01",
      data: { channelId: "c1" },
    });
    expect(decodePayload(encoded)).toEqual({
      reqId: "r1",
      traceparent: "00-a-b-01",
      data: { channelId: "c1" },
    });
  });

  it("stores nothing for an empty payload", () => {
    expect(encodePayload({ kind: "capture", data: {} })).toBeNull();
    expect(decodePayload(null)).toEqual({});
    expect(decodePayload("")).toEqual({});
  });

  it("decodes a poison payload as empty instead of throwing", () => {
    expect(decodePayload("{not json")).toEqual({});
    expect(decodePayload("[1,2]")).toEqual({});
    expect(decodePayload('{"reqId":5,"data":"x","traceparent":null}')).toEqual({});
  });
});

describe("row mappings", () => {
  it("maps a claimed row to a job for attempt n", () => {
    const payload = encodePayload({ kind: "capture", reqId: "r1", traceparent: "tp" });
    const job = toDatabaseJob({ ...row, shardId: "s1", payload }, 2, 1000);
    expect(job).toEqual({
      buildId: "b1",
      jobId: "j1",
      kind: "capture",
      attempt: 2,
      attempts: 1,
      maxAttempts: 3,
      receipt: "j1:2",
      leaseMs: 1000,
      data: {},
      shard: "s1",
      reqId: "r1",
      traceparent: "tp",
    });
  });

  it("gives a build-less job an empty build id", () => {
    expect(toDatabaseJob({ ...row, buildId: null }, 1, 1).buildId).toBe("");
    expect(toQueueEntry({ ...row, buildId: null }).buildId).toBe("");
  });

  it("maps job rows to queue entries", () => {
    expect(toQueueEntry(row)).toEqual({ buildId: "b1", status: "queued", queuedAt: "t0" });
    expect(
      toQueueEntry({
        ...row,
        status: "done",
        shardId: "s1",
        startedAt: "t1",
        finishedAt: "t2",
        error: "e",
      }),
    ).toEqual({
      buildId: "b1",
      shard: "s1",
      status: "completed",
      queuedAt: "t0",
      startedAt: "t1",
      finishedAt: "t2",
      error: "e",
    });
    expect(toQueueEntry({ ...row, status: "expired" }).status).toBe("failed");
    expect(toQueueEntry({ ...row, status: "cancelled" }).status).toBe("cancelled");
  });
});
