import { describe, expect, it } from "vitest";
import { isChildMessage, isParentMessage } from "./protocol.ts";

describe("isChildMessage", () => {
  it("accepts every well-formed child message", () => {
    expect(isChildMessage({ type: "progress", runId: "r1" })).toBe(true);
    expect(isChildMessage({ type: "done", runId: "r1" })).toBe(true);
    expect(isChildMessage({ type: "failed", runId: "r1", error: "boom" })).toBe(true);
  });

  it("rejects malformed or unknown payloads, and the old pull messages", () => {
    for (const bad of [
      null,
      "done",
      42,
      {},
      { type: "done" },
      { type: "done", runId: 1 },
      { type: "failed", runId: "r1" },
      { type: "progress", receipt: "r1" },
      { type: "poll", id: 1, waitMs: 10 },
      { type: "ack", receipt: "r1" },
      { type: "nack", receipt: "r1", requeue: true },
      { type: "enqueue", job: { buildId: "b1" } },
      { type: "mystery", runId: "r1" },
    ]) {
      expect(isChildMessage(bad)).toBe(false);
    }
  });
});

describe("isParentMessage", () => {
  it("accepts run and cancel", () => {
    expect(isParentMessage({ type: "cancel", runId: "r1" })).toBe(true);
    expect(
      isParentMessage({ type: "run", runId: "r1", job: { buildId: "b1", receipt: "j:1" } }),
    ).toBe(true);
  });

  it("rejects malformed pushes", () => {
    for (const bad of [
      null,
      {},
      { type: "run", runId: "r1" },
      { type: "run", runId: "r1", job: {} },
      { type: "run", runId: "r1", job: { buildId: "" } },
      { type: "run", job: { buildId: "b1" } },
      { type: "cancel" },
      { type: "empty", id: 1 },
    ]) {
      expect(isParentMessage(bad)).toBe(false);
    }
  });
});
