import { describe, expect, it, vi } from "vitest";
import { FakeChild } from "../../test-helpers/fake-child.ts";
import type { ConsumerJob, JobRunContext, KindHandler } from "../consumer/types.ts";
import { createForkedCaptureHandler, type ForkedCaptureOptions } from "./forked-capture.ts";

const tick = async (ms = 0): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const job = (buildId: string, extra: Partial<ConsumerJob> = {}): ConsumerJob => ({
  buildId,
  receipt: `${buildId}:1`,
  attempts: 0,
  ...extra,
});

function context(): JobRunContext & { touches: number } {
  const ctx = {
    touches: 0,
    logger: {} as never,
    touch: () => {
      ctx.touches += 1;
    },
  };
  return ctx;
}

function fallback(): KindHandler & { ran: string[]; cancelled: string[] } {
  const ran: string[] = [];
  const cancelled: string[] = [];
  return {
    ran,
    cancelled,
    run: async (j) => {
      ran.push(j.buildId);
      await Promise.resolve();
    },
    cancel: async (j) => {
      cancelled.push(j.buildId);
      await Promise.resolve();
    },
  };
}

/** A parent whose spawn hands out fake children, newest last. */
function rig(overrides: Partial<ForkedCaptureOptions> = {}) {
  const children: FakeChild[] = [];
  const back = fallback();
  const handler = createForkedCaptureHandler({
    spawn: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    fallback: back,
    restartDelayMs: 1,
    ...overrides,
  });
  const latest = (): FakeChild => children.at(-1) as FakeChild;
  return { handler, children, latest, back };
}

/** The `run` pushed for `buildId`, wherever it was sent. */
function pushedTo(child: FakeChild, buildId: string) {
  return child.pushed().find((message) => message.job.buildId === buildId);
}

describe("createForkedCaptureHandler", () => {
  it("pushes a leased job to the child and resolves when the child reports it done", async () => {
    const { handler, latest } = rig();
    const ctx = context();
    const running = handler.run(job("b1", { reqId: "req-1", traceparent: "00-abc" }), ctx);
    await tick();
    expect(pushedTo(latest(), "b1")).toMatchObject({
      type: "run",
      job: { buildId: "b1", reqId: "req-1", traceparent: "00-abc", receipt: "b1:1" },
    });
    latest().say({ type: "progress", runId: pushedTo(latest(), "b1")?.runId });
    latest().say({ type: "done", runId: pushedTo(latest(), "b1")?.runId });
    await expect(running).resolves.toBeUndefined();
    expect(ctx.touches).toBe(1);
  });

  it("forks the child once, for the first job, and reuses it", async () => {
    const { handler, children, latest } = rig();
    expect(children).toHaveLength(0);
    const first = handler.run(job("b1"), context());
    const second = handler.run(job("b2"), context());
    await tick();
    expect(children).toHaveLength(1);
    for (const id of ["b1", "b2"]) {
      latest().say({ type: "done", runId: pushedTo(latest(), id)?.runId });
    }
    await Promise.all([first, second]);
  });

  it("rejects with the child's error when it reports a failure", async () => {
    const { handler, latest } = rig();
    const running = handler.run(job("b1"), context());
    await tick();
    latest().say({ type: "failed", runId: pushedTo(latest(), "b1")?.runId, error: "render broke" });
    await expect(running).rejects.toThrow("render broke");
  });

  it("ignores progress and results for runs it does not know, and junk", async () => {
    const { handler, latest } = rig();
    const running = handler.run(job("b1"), context());
    await tick();
    latest().say({ type: "done", runId: "nope" });
    latest().say("noise");
    latest().say({ type: "progress" });
    latest().say({ type: "done", runId: pushedTo(latest(), "b1")?.runId });
    await expect(running).resolves.toBeUndefined();
  });

  describe("crashes", () => {
    it("charges a crash to the only run out, fails it, and starts a fresh child for the next", async () => {
      const onCrashed = vi.fn(async () => {});
      const { handler, children, latest } = rig({ onCrashed, maxRetries: 2 });
      const running = handler.run(job("b1", { attempts: 0 }), context());
      await tick();
      latest().exit(1);
      await expect(running).rejects.toThrow(/exited \(code 1\)/u);
      expect(onCrashed).not.toHaveBeenCalled(); // not its last attempt: the consumer retries it

      const next = handler.run(job("b2"), context());
      await tick();
      expect(children).toHaveLength(2);
      latest().say({ type: "done", runId: pushedTo(latest(), "b2")?.runId });
      await next;
    });

    it("writes the failure itself when the child killed the job's last attempt", async () => {
      const onCrashed = vi.fn(async () => {});
      const { handler, latest } = rig({ onCrashed });
      const last = job("b1", { attempt: 3, maxAttempts: 3, attempts: 2 });
      const running = handler.run(last, context());
      await tick();
      latest().exit(null, "SIGKILL");
      await expect(running).rejects.toThrow(/signal SIGKILL/u);
      expect(onCrashed).toHaveBeenCalledWith(last, expect.stringContaining("signal SIGKILL"));
    });

    it("survives a crash hook that throws", async () => {
      const { handler, latest } = rig({
        onCrashed: async () => {
          await Promise.resolve();
          throw new Error("hook broke");
        },
      });
      const running = handler.run(job("b1", { attempt: 1, maxAttempts: 1 }), context());
      await tick();
      latest().exit(1);
      await expect(running).rejects.toThrow(/exited/u);
    });

    it("pushes the runs that shared a crashed child again, uncharged and one at a time", async () => {
      const { handler, children, latest } = rig({ crashLimit: 10 });
      const a = handler.run(job("a"), context());
      const b = handler.run(job("b"), context());
      await tick();
      expect(latest().pushed()).toHaveLength(2);
      latest().exit(1);
      await tick(20);
      // Neither was charged: both come back, but only one is out at a time.
      expect(children).toHaveLength(2);
      const second = latest();
      expect(second.pushed()).toHaveLength(1);
      const firstId = second.pushed()[0]?.job.buildId as string;
      second.say({ type: "done", runId: second.pushed()[0]?.runId });
      await tick(5);
      expect(second.pushed()).toHaveLength(2);
      second.say({ type: "done", runId: second.pushed()[1]?.runId });
      await Promise.all([a, b]);
      expect(["a", "b"]).toContain(firstId);
    });

    it("names the culprit when a solo run crashes again", async () => {
      const { handler, latest } = rig({ crashLimit: 10 });
      const a = handler.run(job("a"), context());
      const b = handler.run(job("b"), context());
      a.catch(() => {});
      b.catch(() => {});
      await tick();
      latest().exit(1);
      await tick(20);
      const culprit = latest().pushed()[0]?.job.buildId as string;
      latest().exit(1);
      await expect(culprit === "a" ? a : b).rejects.toThrow(/exited/u);
    });

    it("counts an unrequested clean exit with work out as a crash", async () => {
      const { handler, latest } = rig();
      const running = handler.run(job("b1"), context());
      await tick();
      latest().exit(0);
      await expect(running).rejects.toThrow(/exited \(code 0\)/u);
    });

    it("does not count a clean exit with nothing running", async () => {
      const { handler, children, latest } = rig({ crashLimit: 1 });
      const first = handler.run(job("b1"), context());
      await tick();
      latest().say({ type: "done", runId: pushedTo(latest(), "b1")?.runId });
      await first;
      latest().exit(0);
      expect(handler.tripped).toBe(false);
      const second = handler.run(job("b2"), context());
      await tick();
      expect(children).toHaveLength(2);
      latest().say({ type: "done", runId: pushedTo(latest(), "b2")?.runId });
      await second;
    });

    it("gives up on forking after a crash loop and runs everything in-process", async () => {
      const { handler, latest, back } = rig({ crashLimit: 2 });
      for (const id of ["b1", "b2"]) {
        const running = handler.run(job(id), context());
        running.catch(() => {});
        // oxlint-disable-next-line no-await-in-loop -- one crash after another
        await tick();
        latest().exit(1);
        // oxlint-disable-next-line no-await-in-loop
        await running.catch(() => {});
      }
      expect(handler.tripped).toBe(true);
      await handler.run(job("b3"), context());
      expect(back.ran).toEqual(["b3"]);
    });

    it("moves a run that shared the crash that tripped the loop to the in-process handler", async () => {
      const { handler, latest, back } = rig({ crashLimit: 1 });
      const a = handler.run(job("a"), context());
      const b = handler.run(job("b"), context());
      a.catch(() => {});
      b.catch(() => {});
      await tick();
      latest().exit(1);
      await tick(20);
      expect(handler.tripped).toBe(true);
      expect(new Set(back.ran)).toEqual(new Set(["a", "b"]));
    });
  });

  describe("a child that cannot start", () => {
    it("falls back when forking throws", async () => {
      const back = fallback();
      const handler = createForkedCaptureHandler({
        spawn: () => {
          throw new Error("no fork here");
        },
        fallback: back,
      });
      await handler.run(job("b1"), context());
      expect(handler.tripped).toBe(true);
      expect(back.ran).toEqual(["b1"]);
    });
  });

  describe("hang detection", () => {
    it("kills a child that makes no progress and charges the hung run only", async () => {
      const { handler, latest } = rig({ leaseMs: 40, crashLimit: 10 });
      const hung = handler.run(job("hung"), context());
      hung.catch(() => {});
      await tick();
      const child = latest();
      // A second run keeps reporting, so only the first is hung.
      const healthy = handler.run(job("healthy"), context());
      await tick();
      const healthyRun = pushedTo(child, "healthy")?.runId;
      for (let step = 0; step < 4; step += 1) {
        // oxlint-disable-next-line no-await-in-loop -- pace the progress against the lease
        await tick(15);
        child.say({ type: "progress", runId: healthyRun });
      }
      expect(child.killed).toBe(true);
      expect(child.forced).toBe(true);
      child.exit(null, "SIGKILL");
      await expect(hung).rejects.toThrow(/no progress/u);
      // The healthy run was not at fault: it is pushed again to a fresh child.
      await tick(20);
      const fresh = latest();
      expect(fresh).not.toBe(child);
      fresh.say({ type: "done", runId: fresh.pushed()[0]?.runId });
      await healthy;
    });

    it("keeps a child alive while it reports progress", async () => {
      const { handler, latest } = rig({ leaseMs: 60 });
      const running = handler.run(job("slow"), context());
      await tick();
      for (let step = 0; step < 5; step += 1) {
        // oxlint-disable-next-line no-await-in-loop -- pace the progress against the lease
        await tick(20);
        latest().say({ type: "progress", runId: pushedTo(latest(), "slow")?.runId });
      }
      expect(latest().killed).toBe(false);
      latest().say({ type: "done", runId: pushedTo(latest(), "slow")?.runId });
      await running;
    });
  });

  describe("cancel", () => {
    it("tells the child to stop the run", async () => {
      const { handler, latest } = rig();
      const running = handler.run(job("b1"), context());
      running.catch(() => {});
      await tick();
      const runId = pushedTo(latest(), "b1")?.runId;
      await handler.cancel?.(job("b1"));
      expect(latest().sent.at(-1)).toEqual({ type: "cancel", runId });
      latest().say({ type: "failed", runId, error: "cancelled" });
      await expect(running).rejects.toThrow("cancelled");
    });

    it("keeps a job the consumer gave up on from being pushed later", async () => {
      const { handler, latest } = rig({ crashLimit: 10 });
      const a = handler.run(job("a"), context());
      const b = handler.run(job("b"), context());
      a.catch(() => {});
      b.catch(() => {});
      await tick();
      latest().exit(1); // both go back, one at a time
      await tick(20);
      const waiting = latest().pushed()[0]?.job.buildId === "a" ? job("b") : job("a");
      await handler.cancel?.(waiting);
      latest().say({ type: "done", runId: latest().pushed()[0]?.runId });
      await expect(waiting.buildId === "a" ? a : b).rejects.toThrow(/cancelled before it ran/u);
      expect(latest().pushed()).toHaveLength(1);
    });

    it("cancels in-process once forking was given up", async () => {
      const { handler, back } = rig({
        spawn: () => {
          throw new Error("no fork");
        },
      });
      await handler.run(job("b1"), context());
      await handler.cancel?.(job("b2"));
      expect(back.cancelled).toEqual(["b2"]);
    });
  });

  describe("close", () => {
    it("stops the child and fails what was still out", async () => {
      const { handler, latest } = rig();
      const running = handler.run(job("b1"), context());
      running.catch(() => {});
      await tick();
      await handler.close();
      expect(latest().killed).toBe(true);
      await expect(running).rejects.toThrow(/stopped/u);
    });

    it("is quiet when no child was ever forked", async () => {
      const { handler, children } = rig();
      await handler.close();
      expect(children).toHaveLength(0);
    });

    it("runs a job that arrives after close in-process", async () => {
      const { handler, back } = rig();
      await handler.close();
      await handler.run(job("late"), context());
      expect(back.ran).toEqual(["late"]);
    });
  });

  it("accepts what the fallback accepts", () => {
    const back: KindHandler = { run: async () => {}, accepts: (j) => j.buildId !== "bad" };
    const handler = createForkedCaptureHandler({ spawn: () => new FakeChild(), fallback: back });
    expect(handler.accepts?.(job("bad"))).toBe(false);
    expect(handler.accepts?.(job("good"))).toBe(true);
  });
});
