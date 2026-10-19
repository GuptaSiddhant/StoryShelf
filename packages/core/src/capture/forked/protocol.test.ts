import { describe, expect, it } from "vitest";
import { isChildMessage, isParentMessage } from "./protocol.ts";

describe("isChildMessage", () => {
  it("accepts every well-formed child message", () => {
    expect(isChildMessage({ type: "poll", id: 1, waitMs: 10 })).toBe(true);
    expect(isChildMessage({ type: "ack", receipt: "r1" })).toBe(true);
    expect(isChildMessage({ type: "nack", receipt: "r1", requeue: true, delayMs: 5 })).toBe(true);
    expect(isChildMessage({ type: "enqueue", job: { buildId: "b1" } })).toBe(true);
  });

  it("rejects malformed or unknown payloads", () => {
    for (const bad of [
      null,
      "poll",
      42,
      {},
      { type: "poll" },
      { type: "poll", id: "1", waitMs: 1 },
      { type: "ack" },
      { type: "nack", receipt: "r1" },
      { type: "enqueue", job: {} },
      { type: "enqueue", job: { buildId: "" } },
      { type: "mystery" },
    ]) {
      expect(isChildMessage(bad)).toBe(false);
    }
  });
});

describe("isParentMessage", () => {
  it("accepts job and empty answers", () => {
    expect(isParentMessage({ type: "empty", id: 1 })).toBe(true);
    expect(isParentMessage({ type: "job", id: 1, job: { buildId: "b1", receipt: "r1" } })).toBe(
      true,
    );
  });

  it("rejects malformed answers", () => {
    for (const bad of [
      null,
      {},
      { type: "empty" },
      { type: "job", id: 1 },
      { type: "job", id: 1, job: {} },
    ]) {
      expect(isParentMessage(bad)).toBe(false);
    }
  });
});
