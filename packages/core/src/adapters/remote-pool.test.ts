import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../test-helpers/index.ts";
import type { RemoteConnectContext } from "./remote-browser.ts";
import { shutdownRemote } from "./remote-lease.ts";
import { refCounted, type PoolLease, type RefCounted } from "./remote-pool.ts";

const ctx = (signal = new AbortController().signal): RemoteConnectContext => ({
  engine: "chromium",
  buildId: "b1",
  runId: "b1",
  purpose: "render",
  attempt: 1,
  signal,
});

const info = { outcome: "finished" } as const;

interface Computer {
  host: string;
}

let pools: RefCounted<Computer>[] = [];

function pool(overrides: Partial<Parameters<typeof refCounted<Computer>>[0]> = {}) {
  let wakes = 0;
  const open = vi.fn(async (_context: RemoteConnectContext, _signal: AbortSignal) => {
    wakes += 1;
    return await Promise.resolve({ host: `computer-${wakes}` });
  });
  const close = vi.fn(async (_computer: Computer) => await Promise.resolve());
  const made = refCounted<Computer>({ open, close, idleMs: 20, ...overrides });
  pools.push(made);
  const connect = made.connect((computer) => ({ endpoint: `wss://${computer.host}/run` }));
  return { made, open, close, connect };
}

/** A clock the test moves by hand: tasks run when `advance` passes their time. */
function manualClock() {
  let now = 0;
  let nextId = 0;
  const tasks = new Map<number, { at: number; run: () => void }>();
  return {
    schedule: (run: () => void, ms: number): (() => void) => {
      nextId += 1;
      const id = nextId;
      tasks.set(id, { at: now + ms, run });
      return () => {
        tasks.delete(id);
      };
    },
    advance: async (ms: number): Promise<void> => {
      now += ms;
      for (const [id, task] of tasks) {
        if (task.at <= now) {
          tasks.delete(id);
          task.run();
        }
      }
      // Let what the task started (a close, an open) settle before the test looks.
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

afterEach(async () => {
  await shutdownRemote();
  for (const made of pools) made.dispose();
  pools = [];
});

describe("refCounted", () => {
  it("opens once for concurrent first connects and gives them the same resource", async () => {
    const { open, connect } = pool();
    const connections = await Promise.all([connect(ctx()), connect(ctx()), connect(ctx())]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(new Set(connections.map((c) => c.endpoint))).toEqual(new Set(["wss://computer-1/run"]));
  });

  it("closes the resource idleMs after the last release, not before", async () => {
    const clock = manualClock();
    const { made, close, connect } = pool({ idleMs: 30, schedule: clock.schedule });
    const a = await connect(ctx());
    const b = await connect(ctx());
    await made.release(a.lease as PoolLease, info);
    await clock.advance(100);
    expect(close).not.toHaveBeenCalled();
    await made.release(b.lease as PoolLease, info);
    await clock.advance(29);
    expect(close).not.toHaveBeenCalled();
    await clock.advance(1);
    expect(close).toHaveBeenCalledWith({ host: "computer-1" });
  });

  it("reuses an idle resource that has not closed yet, cancelling the timer", async () => {
    const clock = manualClock();
    const { made, open, close, connect } = pool({ idleMs: 30, schedule: clock.schedule });
    const a = await connect(ctx());
    await made.release(a.lease as PoolLease, info);
    await clock.advance(29);
    const b = await connect(ctx());
    await clock.advance(100);
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    await made.release(b.lease as PoolLease, info);
  });

  it("makes a connect that arrives during close wait, then open again", async () => {
    const clock = manualClock();
    const closing = deferred();
    const { made, open, close, connect } = pool({ idleMs: 5, schedule: clock.schedule });
    close.mockImplementationOnce(async () => {
      await closing.promise;
    });
    const a = await connect(ctx());
    await made.release(a.lease as PoolLease, info);
    await clock.advance(5);
    expect(close).toHaveBeenCalledTimes(1);
    const next = connect(ctx());
    await clock.advance(20);
    expect(open).toHaveBeenCalledTimes(1);
    closing.resolve();
    expect((await next).endpoint).toBe("wss://computer-2/run");
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("shares a failed open among its waiters, caches nothing, and tries again next time", async () => {
    const { open, connect } = pool();
    open.mockRejectedValueOnce(new Error("wake failed"));
    const results = await Promise.allSettled([connect(ctx()), connect(ctx())]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(open).toHaveBeenCalledTimes(1);
    expect((await connect(ctx())).endpoint).toBe("wss://computer-1/run");
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("closes what a failed open names on its error", async () => {
    const { open, close, connect } = pool();
    open.mockRejectedValueOnce(Object.assign(new Error("half"), { resource: { host: "half" } }));
    await expect(connect(ctx())).rejects.toThrow("half");
    expect(close).toHaveBeenCalledWith({ host: "half" });
  });

  it("aborts open only when every waiter has been cancelled", async () => {
    let seen: AbortSignal | undefined;
    const { open, connect } = pool();
    open.mockImplementationOnce(
      async (_context, signal) =>
        await new Promise<Computer>((_, reject) => {
          seen = signal;
          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const one = new AbortController();
    const two = new AbortController();
    const first = connect(ctx(one.signal)).catch((caught: unknown) => caught);
    const second = connect(ctx(two.signal)).catch((caught: unknown) => caught);
    // Both waiters registered when connect was called; an abort is delivered synchronously.
    one.abort();
    expect(seen?.aborted).toBe(false);
    two.abort();
    await Promise.all([first, second]);
    expect(seen?.aborted).toBe(true);
  });

  it("marks the resource unknown after a failed close: the next connect opens again, and the close is retried", async () => {
    const warn = vi.fn();
    const { made, open, close, connect } = pool({ idleMs: 10, logger: { warn } as never });
    close.mockRejectedValueOnce(new Error("suspend failed: secret-host"));
    const a = await connect(ctx());
    await made.release(a.lease as PoolLease, info);
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledTimes(1);
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-host");
    expect(warn.mock.calls[0]?.[0]).toEqual({ err: "Error" });
    // Left alone, the idle timer retries the close on the old reference.
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledTimes(2);
    });
    expect(close).toHaveBeenLastCalledWith({ host: "computer-1" });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens again on the next connect after a failed close, not reusing the resource", async () => {
    const { made, open, close, connect } = pool({ idleMs: 5 });
    close.mockRejectedValue(new Error("suspend failed"));
    const a = await connect(ctx());
    await made.release(a.lease as PoolLease, info);
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalled();
    });
    const b = await connect(ctx());
    expect(open).toHaveBeenCalledTimes(2);
    expect(b.endpoint).toBe("wss://computer-2/run");
  });

  it("treats a close that exceeds closeTimeoutMs as failed", async () => {
    const warn = vi.fn();
    const { made, close, connect } = pool({
      idleMs: 5,
      closeTimeoutMs: 10,
      logger: { warn } as never,
    });
    close.mockImplementationOnce(async () => await new Promise<void>(() => {}));
    const a = await connect(ctx());
    await made.release(a.lease as PoolLease, info);
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
    expect(warn.mock.calls[0]?.[0]).toEqual({ err: "CloseTimeout" });
  });

  it("closes at once on shutdown, ignoring idleMs, and aborts an open in progress", async () => {
    const { made, open, close, connect } = pool({ idleMs: 60_000 });
    const a = await connect(ctx());
    await made.release(a.lease as PoolLease, info);
    await shutdownRemote();
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({ host: "computer-1" });

    let aborted = false;
    const entered = deferred();
    open.mockImplementationOnce(
      async (_context, signal) =>
        await new Promise<Computer>((resolve) => {
          entered.resolve();
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve({ host: "woken" });
          });
        }),
    );
    const pending = connect(ctx()).catch((caught: unknown) => caught);
    await entered.promise;
    await shutdownRemote();
    await pending;
    expect(aborted).toBe(true);
    expect(close).toHaveBeenLastCalledWith({ host: "woken" });
  });

  it("releases its share if building the connection throws", async () => {
    const { made, close } = pool({ idleMs: 5 });
    const connect = made.connect(() => {
      throw new Error("bad build");
    });
    await expect(connect(ctx())).rejects.toThrow("bad build");
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  it("does not run on shutdown once disposed", async () => {
    const { made, close, connect } = pool({ idleMs: 60_000 });
    await connect(ctx());
    made.dispose();
    await shutdownRemote();
    expect(close).not.toHaveBeenCalled();
  });
});
