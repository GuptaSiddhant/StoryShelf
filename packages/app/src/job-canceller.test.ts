import type { CaptureQueue } from "@storyshelf/core/adapter/capture-queue";
import { describe, expect, it, vi } from "vitest";
import { createJobCanceller } from "./job-canceller.ts";

function queueWith(cancel?: (id: string) => Promise<boolean>): CaptureQueue {
  return { cancel } as unknown as CaptureQueue;
}

describe("createJobCanceller", () => {
  it("asks every queue that can cancel and reports whether any job was affected", async () => {
    const first = vi.fn(async () => false);
    const second = vi.fn(async () => true);
    const cancel = createJobCanceller([queueWith(first), queueWith(second)]);
    expect(await cancel("b1")).toBe(true);
    expect(first).toHaveBeenCalledWith("b1");
    expect(second).toHaveBeenCalledWith("b1");
  });

  it("skips absent queues and queues without cancel", async () => {
    const cancel = createJobCanceller([null, undefined, queueWith()]);
    expect(await cancel("b1")).toBe(false);
  });
});
