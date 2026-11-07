import { describe, expect, it, vi } from "vitest";
import { BuildModel } from "../../models/build.ts";
import { CaptureJobModel } from "../../models/capture-job.ts";
import { makeDatabase } from "../../test-helpers/fake-database.ts";
import { claimNext } from "./claim.ts";
import { toQueueEntry } from "./codec.ts";
import { LEASE_EXHAUSTED_ERROR, MAX_HOOK_RUNS } from "./exhaust.ts";
import { cancelJobs } from "./operations.ts";
import { ackJob } from "./poll.ts";
import type { DatabaseJob, QueueRuntime } from "./types.ts";
import { createWakeSignal } from "./wake.ts";

type Hook = NonNullable<QueueRuntime["onExhausted"]>;

function runtime(options: { transactions?: boolean } = {}): {
  rt: QueueRuntime;
  clock: { now: number };
} {
  const { db } = makeDatabase();
  if (options.transactions === false) delete db.transact;
  const clock = { now: Date.parse("2026-01-01T00:00:00.000Z") };
  const rt: QueueRuntime = {
    model: new CaptureJobModel(db),
    builds: new BuildModel(db),
    kinds: ["capture"],
    leaseMs: 1000,
    maxAttempts: 2,
    owner: "me",
    now: () => clock.now,
    wake: createWakeSignal(),
    pollVersion: 0,
  };
  return { rt, clock };
}

const iso = (ms: number): string => new Date(ms).toISOString();
const failing: Hook = async () => {
  await Promise.resolve();
  throw new Error("hook broke");
};

/** Queue a job and let both of its attempts lose their lease; the next claim is the first hook run. */
async function spendAttempts(rt: QueueRuntime, clock: { now: number }): Promise<void> {
  await rt.model.create(
    { id: "j1", kind: "capture", buildId: "b1", maxAttempts: 2 },
    iso(clock.now),
  );
  await claimNext(rt);
  clock.now += 1001;
  await claimNext(rt);
  clock.now += 1001;
}

/** Let the running hook's lease run out and claim the next run on `queue`. */
async function nextRun(queue: QueueRuntime, clock: { now: number }): Promise<void> {
  clock.now += 1001;
  await claimNext(queue);
}

/** Run `inject` right after the next read of row `id`, so the caller acts on a row that just went stale. */
function afterNextRead(rt: QueueRuntime, id: string, inject: () => Promise<void>, skip = 0): void {
  const read = rt.model.get.bind(rt.model);
  let left = skip;
  let armed = true;
  rt.model.get = async (target) => {
    const row = await read(target);
    if (target === id && left > 0) {
      left -= 1;
    } else if (target === id && armed) {
      armed = false;
      await inject();
    }
    return row;
  };
}

describe("exhausted-job recovery", () => {
  it("runs the hook as a leased attempt, then fails the job", async () => {
    const { rt, clock } = runtime();
    const hook = vi.fn<Hook>(async () => {});
    rt.onExhausted = hook;
    await spendAttempts(rt, clock);
    expect(await claimNext(rt)).toBeNull();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j1", kind: "capture", buildId: "b1" }),
      LEASE_EXHAUSTED_ERROR,
    );
    expect(await rt.model.get("j1")).toMatchObject({
      status: "failed",
      error: LEASE_EXHAUSTED_ERROR,
      visibleAt: null,
    });
    expect(await rt.model.get("j1:2")).toMatchObject({ status: "expired" });
    expect(await rt.model.get("j1:3")).toMatchObject({ status: "done", visibleAt: null });
  });

  it("keeps the job exhausting, and shows it as recovering, after a failed hook run", async () => {
    const { rt, clock } = runtime();
    const hook = vi.fn<Hook>(failing);
    rt.onExhausted = hook;
    await spendAttempts(rt, clock);
    await claimNext(rt);
    const row = (await rt.model.get("j1"))!;
    expect(row).toMatchObject({ status: "exhausting", attempt: 3, visibleAt: null });
    expect(toQueueEntry(row).status).toBe("recovering");
    expect(await rt.model.get("j1:3")).toMatchObject({ status: "running", owner: "me" });
    expect((await rt.model.listActive(["capture"])).map((one) => one.status)).toEqual([
      "exhausting",
    ]);
    // The lease paces the retry: nothing runs the hook again before it ends.
    expect(await claimNext(rt)).toBeNull();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("lets a second instance re-run the hook once the first one's lease ended", async () => {
    const { rt, clock } = runtime();
    rt.onExhausted = failing;
    await spendAttempts(rt, clock);
    await claimNext(rt);
    const healthy = vi.fn<Hook>(async () => {});
    const other: QueueRuntime = { ...rt, owner: "other", onExhausted: healthy };
    await nextRun(other, clock);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(await rt.model.get("j1")).toMatchObject({ status: "failed" });
    expect(await rt.model.get("j1:3")).toMatchObject({ status: "expired" });
    expect(await rt.model.get("j1:4")).toMatchObject({ status: "done", owner: "other" });
  });

  it("recovers a hook run whose instance died before replacing the expired attempt", async () => {
    const { rt, clock } = runtime();
    const hook = vi.fn<Hook>(async () => {});
    rt.onExhausted = hook;
    await spendAttempts(rt, clock);
    // The claimer inserted run 3 and died; attempt 2 still reads running.
    await rt.model.claim(
      {
        job: (await rt.model.get("j1"))!,
        attempt: 3,
        owner: "dead",
        leaseUntil: iso(clock.now + 500),
      },
      iso(clock.now),
    );
    expect(await claimNext(rt)).toBeNull();
    expect(hook).not.toHaveBeenCalled();
    await nextRun(rt, clock);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(await rt.model.get("j1")).toMatchObject({ status: "failed" });
    expect(await rt.model.get("j1:2")).toMatchObject({ status: "expired" });
    expect(await rt.model.get("j1:3")).toMatchObject({ status: "expired" });
    expect(await rt.model.get("j1:4")).toMatchObject({ status: "done" });
  });

  it("recovers a hook run whose instance died while running the hook", async () => {
    const { rt, clock } = runtime();
    const hook = vi.fn<Hook>(async () => {});
    rt.onExhausted = hook;
    await spendAttempts(rt, clock);
    // Run 3 replaced attempt 2, marked the job exhausting and died inside the hook.
    await rt.model.finishAttempt("j1:2", "expired", iso(clock.now));
    await rt.model.claim(
      {
        job: (await rt.model.get("j1"))!,
        attempt: 3,
        owner: "dead",
        leaseUntil: iso(clock.now + 500),
      },
      iso(clock.now),
    );
    await rt.model.markExhausting("j1", 3, LEASE_EXHAUSTED_ERROR, iso(clock.now));
    expect(await claimNext(rt)).toBeNull();
    await nextRun(rt, clock);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(await rt.model.get("j1")).toMatchObject({ status: "failed" });
  });

  it("writes nothing from a hook run whose lease another instance took over", async () => {
    const { rt, clock } = runtime();
    const other: QueueRuntime = { ...rt, owner: "other", onExhausted: failing };
    const slow = vi.fn<Hook>(async () => {
      clock.now += 1001;
      await claimNext(other);
    });
    rt.onExhausted = slow;
    await spendAttempts(rt, clock);
    await claimNext(rt);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(await rt.model.get("j1")).toMatchObject({ status: "exhausting", attempt: 4 });
    expect(await rt.model.get("j1:3")).toMatchObject({ status: "expired" });
    expect(await rt.model.get("j1:4")).toMatchObject({ status: "running", owner: "other" });
  });
});

describe("exhausted-job recovery limits", () => {
  it(`gives up after ${String(MAX_HOOK_RUNS)} runs, fails the job and alerts once`, async () => {
    const { rt, clock } = runtime();
    const hook = vi.fn<Hook>(failing);
    const abandoned = vi.fn<Hook>(async () => {});
    rt.onExhausted = hook;
    rt.onAbandoned = abandoned;
    await spendAttempts(rt, clock);
    await claimNext(rt);
    for (let run = 2; run <= MAX_HOOK_RUNS; run += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- runs are sequential
      await nextRun(rt, clock);
    }
    expect(hook).toHaveBeenCalledTimes(MAX_HOOK_RUNS);
    expect(abandoned).not.toHaveBeenCalled();
    expect(await rt.model.get("j1")).toMatchObject({
      status: "exhausting",
      attempt: 2 + MAX_HOOK_RUNS,
    });
    await nextRun(rt, clock);
    expect(hook).toHaveBeenCalledTimes(MAX_HOOK_RUNS);
    expect(abandoned).toHaveBeenCalledTimes(1);
    expect(abandoned).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j1", buildId: "b1" }),
      LEASE_EXHAUSTED_ERROR,
    );
    expect(await rt.model.get("j1")).toMatchObject({
      status: "failed",
      error: LEASE_EXHAUSTED_ERROR,
    });
    clock.now += 5000;
    expect(await claimNext(rt)).toBeNull();
    expect(abandoned).toHaveBeenCalledTimes(1);
  });

  it("still fails the job when the abandon alert throws or no alert is wired", async () => {
    const { rt, clock } = runtime();
    rt.onExhausted = failing;
    await spendAttempts(rt, clock);
    await claimNext(rt);
    for (let run = 2; run <= MAX_HOOK_RUNS + 1; run += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- runs are sequential
      await nextRun(rt, clock);
    }
    expect((await rt.model.get("j1"))?.status).toBe("failed");

    rt.onAbandoned = failing;
    await rt.model.create(
      { id: "j2", kind: "capture", buildId: "b2", maxAttempts: 2 },
      iso(clock.now),
    );
    await claimNext(rt);
    clock.now += 1001;
    await claimNext(rt);
    clock.now += 1001;
    await claimNext(rt);
    for (let run = 2; run <= MAX_HOOK_RUNS + 1; run += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- runs are sequential
      await nextRun(rt, clock);
    }
    expect((await rt.model.get("j2"))?.status).toBe("failed");
  });
});

describe("exhausted-job recovery races", () => {
  it("lets a late finisher win while the hook is being retried", async () => {
    const { rt, clock } = runtime();
    const hook = vi.fn<Hook>(failing);
    rt.onExhausted = hook;
    await spendAttempts(rt, clock);
    await claimNext(rt);
    // The holder of the final attempt turns out to be alive: it acks.
    await ackJob(rt, { buildId: "b1", receipt: "j1:2" });
    expect((await rt.model.get("j1"))?.status).toBe("done");
    await nextRun(rt, clock);
    expect(hook).toHaveBeenCalledTimes(1);
    expect((await rt.model.get("j1"))?.status).toBe("done");
    expect((await rt.model.get("j1:3"))?.status).toBe("expired");
  });

  it("keeps a late finisher's outcome when it lands while the hook runs", async () => {
    const { rt, clock } = runtime();
    rt.onExhausted = async (job: DatabaseJob) => {
      await ackJob(rt, { buildId: job.buildId, receipt: "j1:2" });
    };
    await spendAttempts(rt, clock);
    await claimNext(rt);
    expect((await rt.model.get("j1"))?.status).toBe("done");
  });

  it("does not overwrite a late finish that lands between the check and the exhausting write", async () => {
    const { rt, clock } = runtime();
    const hook = vi.fn<Hook>(async () => {});
    rt.onExhausted = hook;
    await spendAttempts(rt, clock);
    // The first read of the job is the probe's; the second is the claim's re-read just before the write.
    afterNextRead(
      rt,
      "j1",
      async () => {
        await ackJob(rt, { buildId: "b1", receipt: "j1:2" });
      },
      1,
    );
    expect(await claimNext(rt)).toBeNull();
    expect(hook).not.toHaveBeenCalled();
    expect(await rt.model.get("j1")).toMatchObject({ status: "done" });
    expect(await rt.model.get("j1:3")).toMatchObject({ status: "expired" });
  });

  it("does not overwrite a late finish that lands between the settle read and its write", async () => {
    const { rt, clock } = runtime();
    rt.onExhausted = async () => {
      // The next read of the job row is settle's: the finish lands right after it.
      afterNextRead(rt, "j1", async () => {
        await ackJob(rt, { buildId: "b1", receipt: "j1:2" });
      });
    };
    await spendAttempts(rt, clock);
    await claimNext(rt);
    expect(await rt.model.get("j1")).toMatchObject({ status: "done" });
    expect(await rt.model.get("j1:3")).toMatchObject({ status: "done" });
  });

  it("lets a superseded run neither record itself nor call the hook", async () => {
    const { rt, clock } = runtime();
    const hook = vi.fn<Hook>(failing);
    const other: QueueRuntime = { ...rt, owner: "other", onExhausted: hook };
    rt.onExhausted = hook;
    await spendAttempts(rt, clock);
    // Run 3 is claimed, then pauses before it records itself; run 4 takes over and records itself.
    afterNextRead(
      rt,
      "j1",
      async () => {
        clock.now += 1001;
        await claimNext(other);
      },
      1,
    );
    expect(await claimNext(rt)).toBeNull();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(await rt.model.get("j1")).toMatchObject({ status: "exhausting", attempt: 4 });
    expect(await rt.model.get("j1:3")).toMatchObject({ status: "expired" });
  });

  it("cancels a job that is exhausting instead of running the hook again", async () => {
    const { rt, clock } = runtime();
    const hook = vi.fn<Hook>(failing);
    rt.onExhausted = hook;
    await spendAttempts(rt, clock);
    await claimNext(rt);
    expect(await cancelJobs(rt, "b1")).toBe(true);
    expect(await rt.model.get("j1")).toMatchObject({ status: "exhausting" });
    expect((await rt.model.get("j1"))?.cancelRequestedAt).not.toBeNull();
    expect((await rt.model.get("j1:3"))?.cancelRequestedAt).not.toBeNull();
    await nextRun(rt, clock);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(await rt.model.get("j1")).toMatchObject({ status: "cancelled" });
  });

  it("ends an exhausting job as cancelled when the hook succeeds after a cancel", async () => {
    const { rt, clock } = runtime();
    rt.onExhausted = async (job: DatabaseJob) => {
      await cancelJobs(rt, job.buildId);
    };
    await spendAttempts(rt, clock);
    await claimNext(rt);
    expect((await rt.model.get("j1"))?.status).toBe("cancelled");
  });

  it("gives the claim back when the job ended between the probe and the insert", async () => {
    const { rt, clock } = runtime();
    const hook = vi.fn<Hook>(async () => {});
    rt.onExhausted = hook;
    await spendAttempts(rt, clock);
    const insert = rt.model.claim.bind(rt.model);
    rt.model.claim = async (...args) => {
      const won = await insert(...args);
      await rt.model.finishJob("j1", "cancelled", iso(clock.now));
      return won;
    };
    expect(await claimNext(rt)).toBeNull();
    expect(hook).not.toHaveBeenCalled();
    expect(await rt.model.get("j1:3")).toMatchObject({ status: "expired" });
  });
});

describe("exhausted single-flight jobs", () => {
  const keyed = {
    kind: "capture",
    buildId: "b1",
    shardId: null,
    maxAttempts: 2,
    payload: null,
  } as const;

  async function startKeyed(rt: QueueRuntime, clock: { now: number }): Promise<void> {
    await rt.model.createKeyed({ id: "j1", ...keyed, activeKey: "capture:b1" }, iso(clock.now));
    await claimNext(rt);
    clock.now += 1001;
    await claimNext(rt);
  }

  it("holds its key while a hook run fails, and frees it when the job ends", async () => {
    const { rt, clock } = runtime();
    rt.onExhausted = failing;
    await startKeyed(rt, clock);
    clock.now += 1001;
    await claimNext(rt);
    expect(await rt.model.get("j1")).toMatchObject({
      status: "exhausting",
      activeKey: "capture:b1",
    });
    rt.onExhausted = vi.fn<Hook>(async () => {});
    await nextRun(rt, clock);
    expect(await rt.model.get("j1")).toMatchObject({ status: "failed", activeKey: null });
  });

  it("starts a successor for a request that arrived while the job ran", async () => {
    const { rt, clock } = runtime();
    rt.onExhausted = vi.fn<Hook>(async () => {});
    await startKeyed(rt, clock);
    await rt.model.requestRerun("j1", iso(clock.now));
    clock.now += 1001;
    const during = await claimNext(rt);
    const successor = during ?? (await claimNext(rt));
    expect(await rt.model.get("j1")).toMatchObject({ status: "failed", activeKey: null });
    expect(successor).toMatchObject({ kind: "capture", buildId: "b1" });
    expect(successor?.jobId).not.toBe("j1");
    expect(await rt.model.get(successor?.jobId ?? "")).toMatchObject({ activeKey: "capture:b1" });
  });

  it("starts no successor for a request that arrived before the job was cancelled", async () => {
    const { rt, clock } = runtime();
    rt.onExhausted = vi.fn<Hook>(async () => {});
    await startKeyed(rt, clock);
    await rt.model.requestRerun("j1", iso(clock.now));
    expect(await cancelJobs(rt, "b1")).toBe(true);
    clock.now += 1001;
    expect(await claimNext(rt)).toBeNull();
    expect(await rt.model.get("j1")).toMatchObject({ status: "cancelled", activeKey: null });
    expect(await rt.model.holderOf("capture:b1")).toBeNull();
    expect(await rt.model.nextCandidate(["capture"], iso(clock.now))).toBeNull();
  });

  it("starts no successor when the job was cancelled, and none when no request came", async () => {
    const { rt, clock } = runtime();
    rt.onExhausted = vi.fn<Hook>(async () => {});
    await startKeyed(rt, clock);
    clock.now += 1001;
    await claimNext(rt);
    expect(await rt.model.get("j1")).toMatchObject({ status: "failed", activeKey: null });
    expect(await rt.model.nextCandidate(["capture"], iso(clock.now))).toBeNull();
  });

  it.each([true, false])(
    "hands an exhausting job's request one successor and wakes the poller (transactions: %s)",
    async (transactions) => {
      const { rt, clock } = runtime({ transactions });
      // The request arrives while the exhausted-job hook runs, with the job in `exhausting`.
      rt.onExhausted = vi.fn<Hook>(async () => {
        expect(await rt.model.get("j1")).toMatchObject({ status: "exhausting" });
        await rt.model.requestRerun("j1", iso(clock.now));
      });
      const notify = vi.spyOn(rt.wake, "notify");
      await startKeyed(rt, clock);
      clock.now += 1001;
      await claimNext(rt);
      expect(rt.onExhausted).toHaveBeenCalledOnce();
      const successors = (await rt.model.listForBuild("b1")).filter((row) => row.jobId !== "j1");
      expect(await rt.model.get("j1")).toMatchObject({ status: "failed", activeKey: null });
      expect(successors).toHaveLength(1);
      expect(successors[0]).toMatchObject({ activeKey: "capture:b1" });
      expect(notify).toHaveBeenCalled();
    },
  );

  it("without a hook, fails the job and gives a waiting request its successor", async () => {
    const { rt, clock } = runtime();
    await startKeyed(rt, clock);
    await rt.model.requestRerun("j1", iso(clock.now));
    clock.now += 1001;
    const successor = await claimNext(rt);
    expect(await rt.model.get("j1")).toMatchObject({
      status: "failed",
      error: LEASE_EXHAUSTED_ERROR,
      activeKey: null,
    });
    expect(successor?.jobId).not.toBe("j1");
    expect(await rt.model.get(successor?.jobId ?? "")).toMatchObject({ activeKey: "capture:b1" });
  });
});

describe("the ended-job hook", () => {
  it("is told once a job exhausted without a hook has failed, with its row already written", async () => {
    const { rt, clock } = runtime();
    const seen: string[] = [];
    rt.onEnded = async (job) => {
      seen.push(`${job.jobId}:${(await rt.model.get(job.jobId))?.status}`);
    };
    await spendAttempts(rt, clock);
    await claimNext(rt);
    expect(seen).toEqual(["j1:failed"]);
  });

  it("is told after the exhausted-job hook has run and the job is settled", async () => {
    const { rt, clock } = runtime();
    const seen: string[] = [];
    rt.onExhausted = async () => {
      // Still not ended while the hook runs.
      seen.push(`hook:${(await rt.model.get("j1"))?.status}`);
    };
    rt.onEnded = async (job) => {
      seen.push(`ended:${(await rt.model.get(job.jobId))?.status}`);
    };
    await spendAttempts(rt, clock);
    await claimNext(rt);
    expect(seen).toEqual(["hook:exhausting", "ended:failed"]);
  });

  it("is not called for a job that was cancelled, and a throwing hook blocks nothing", async () => {
    const { rt, clock } = runtime();
    const onEnded = vi.fn(async () => {
      throw new Error("host broke");
    });
    rt.onEnded = onEnded;
    rt.onExhausted = vi.fn<Hook>(async () => {});
    await spendAttempts(rt, clock);
    await cancelJobs(rt, "b1");
    await claimNext(rt);
    expect(onEnded).not.toHaveBeenCalled();

    const other = runtime();
    other.rt.onEnded = onEnded;
    await spendAttempts(other.rt, other.clock);
    await expect(claimNext(other.rt)).resolves.toBeNull();
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(await other.rt.model.get("j1")).toMatchObject({ status: "failed" });
  });
});
