import { makeDatabase } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { createJobQueue } from "./job-queue.ts";

function jobsFor(kinds: Parameters<typeof createJobQueue>[1], retries = 2) {
  const { db } = makeDatabase();
  return createJobQueue({ database: db } as never, kinds, retries);
}

describe("createJobQueue", () => {
  it("builds the database queue on first use only, and shares it", () => {
    const jobs = jobsFor(["capture", "publish"]);
    expect(jobs.built()).toBeUndefined();
    const queue = jobs.get();
    expect(queue.metadata.kind).toBe("database");
    expect(jobs.get()).toBe(queue);
    expect(jobs.built()).toBe(queue);
  });

  it("does not touch the queue to show its view or metadata", () => {
    const jobs = jobsFor(["publish"]);
    expect(jobs.view.metadata.kind).toBe("database");
    expect(jobs.built()).toBeUndefined();
  });

  it("answers the capture-shaped view from the queue", async () => {
    const jobs = jobsFor(["capture"]);
    await jobs.view.enqueue({ buildId: "b1", reqId: "req-1" });
    expect(await jobs.view.status("b1")).toMatchObject({ buildId: "b1", status: "queued" });
    expect(await jobs.view.active()).toHaveLength(1);
    expect(await jobs.view.recent(5)).toHaveLength(1);
  });

  it("polls the given kinds and stamps retries + 1 attempts on the jobs", async () => {
    const jobs = jobsFor(["publish"], 4);
    await jobs.get().enqueueJob({ kind: "capture", buildId: "c1" });
    await jobs.get().enqueueJob({ kind: "publish", buildId: "p1" });
    expect(await jobs.get().poll()).toMatchObject({
      kind: "publish",
      buildId: "p1",
      maxAttempts: 5,
    });
    expect(await jobs.get().poll()).toBeNull();
  });

  it("hands a job that lost its last lease to the hook of its kind", async () => {
    const realNow = Date.now;
    let skew = 0;
    // The queue reads the clock when it is built, so the skew is in place before first use.
    Date.now = () => realNow() + skew;
    try {
      const jobs = jobsFor(["capture"], 0);
      const hook = vi.fn(async () => {});
      jobs.exhausted.capture = hook;
      await jobs.view.enqueue({ buildId: "b1" });
      const queue = jobs.get();
      expect(await queue.poll()).not.toBeNull();
      // The holder dies: once its lease runs out the next poll fails the job and tells the host.
      skew = 10 * 60_000;
      expect(await queue.poll()).toBeNull();
      expect(hook).toHaveBeenCalledWith(
        expect.objectContaining({ buildId: "b1", kind: "capture" }),
        expect.stringContaining("lease expired"),
      );
    } finally {
      Date.now = realNow;
    }
  });
});
