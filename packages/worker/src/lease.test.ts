import type { LeaseRenewal, PollableJob } from "@storyshelf/core/adapter/capture-queue";
import { describe, expect, it, vi } from "vitest";
import { LeaseLostError, startLease } from "./lease.ts";

const job: PollableJob = { buildId: "b1", leaseMs: 30 };
const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

describe("startLease", () => {
  it("returns null without extend or a lease", () => {
    expect(startLease(job, null as never)).toBeNull();
    expect(startLease({ buildId: "b1" }, async () => "ok")).toBeNull();
    expect(startLease({ buildId: "b1", leaseMs: 0 }, async () => "ok")).toBeNull();
  });

  it("renews every third of the lease until stopped", async () => {
    const extend = vi.fn(async (): Promise<LeaseRenewal> => "ok");
    const lease = startLease(job, extend)!;
    await sleep(75);
    expect(extend.mock.calls.length).toBeGreaterThanOrEqual(3);
    lease.stop();
    const calls = extend.mock.calls.length;
    await sleep(50);
    expect(extend.mock.calls.length).toBe(calls);
  });

  it("keeps a capture alive for 2x the lease", async () => {
    const extend = vi.fn(async (): Promise<LeaseRenewal> => "ok");
    const lease = startLease(job, extend)!;
    await sleep(job.leaseMs! * 2 + 15);
    expect(extend.mock.calls.length).toBeGreaterThanOrEqual(5);
    lease.stop();
  });

  it("warns once per job on errors and keeps renewing", async () => {
    const warn = vi.fn();
    const logger = { warn } as unknown as import("@storyshelf/core/logger").Logger;
    const extend = vi.fn(async (): Promise<LeaseRenewal> => {
      throw new Error("throttled");
    });
    const lease = startLease(job, extend, logger)!;
    await sleep(60);
    expect(extend.mock.calls.length).toBeGreaterThan(1);
    expect(warn).toHaveBeenCalledTimes(1);
    lease.stop();
  });

  it("settles `lost` and stops renewing when the lease is lost", async () => {
    const extend = vi.fn(async (): Promise<LeaseRenewal> => "lost");
    const lease = startLease(job, extend)!;
    const outcome = lease.lost.catch((error: unknown) => error);
    expect(await outcome).toBeInstanceOf(LeaseLostError);
    expect(extend).toHaveBeenCalledTimes(1);
  });
});
