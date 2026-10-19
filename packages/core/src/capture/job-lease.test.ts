import { describe, expect, it } from "vitest";
import { ProgressLease } from "./job-lease.ts";

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/** Whether `promise` has settled by now (after letting microtasks run). */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {},
  );
  await sleep(0);
  return done;
}

describe("ProgressLease", () => {
  it("expires when nothing is touched for a full lease", async () => {
    const lease = new ProgressLease(40);
    expect(await settled(lease.expired)).toBe(false);
    await sleep(90);
    expect(await settled(lease.expired)).toBe(true);
  });

  it("is pushed out by progress", async () => {
    const lease = new ProgressLease(80);
    for (let tick = 0; tick < 4; tick += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential progress ticks
      await sleep(30);
      lease.touch();
    }
    expect(await settled(lease.expired)).toBe(false);
    await sleep(160);
    expect(await settled(lease.expired)).toBe(true);
  });

  it("never expires once stopped", async () => {
    const lease = new ProgressLease(20);
    lease.stop();
    await sleep(80);
    expect(await settled(lease.expired)).toBe(false);
  });

  it("is disabled when the lease is 0", async () => {
    const lease = new ProgressLease(0);
    await sleep(40);
    expect(await settled(lease.expired)).toBe(false);
  });
});
