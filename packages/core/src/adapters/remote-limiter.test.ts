import { describe, expect, it, vi } from "vite-plus/test";
import { ConnectionLimiter } from "./remote-limiter.ts";

describe("ConnectionLimiter", () => {
  it("never holds more than the limit, and hands a freed slot to the oldest waiter", async () => {
    const limiter = new ConnectionLimiter(2);
    const [a, b] = await Promise.all([limiter.acquire(), limiter.acquire()]);
    const order: string[] = [];
    const third = limiter.acquire().then((slot) => {
      order.push("third");
      return slot;
    });
    const fourth = limiter.acquire().then((slot) => {
      order.push("fourth");
      return slot;
    });
    expect(limiter.held).toBe(2);
    expect(limiter.waiting).toBe(2);
    a.release();
    const thirdSlot = await third;
    expect(order).toEqual(["third"]);
    expect(limiter.held).toBe(2);
    b.release();
    await fourth;
    expect(order).toEqual(["third", "fourth"]);
    thirdSlot.release();
    expect(limiter.held).toBe(1);
  });

  it("holds the cap under heavy concurrency", async () => {
    const limiter = new ConnectionLimiter(3);
    let inFlight = 0;
    let peak = 0;
    // Every slot is held until the cap is full, so reaching it is certain, not a matter of timing.
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        const slot = await limiter.acquire();
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        if (inFlight === 3) {
          openGate();
        }
        await gate;
        inFlight -= 1;
        slot.release();
      }),
    );
    expect(peak).toBe(3);
    expect(limiter.held).toBe(0);
  });

  it("releases a slot once however often release is called", async () => {
    const limiter = new ConnectionLimiter(1);
    const slot = await limiter.acquire();
    slot.release();
    slot.release();
    expect(limiter.held).toBe(0);
    const next = await limiter.acquire();
    slot.release();
    expect(limiter.held).toBe(1);
    next.release();
    expect(limiter.held).toBe(0);
  });

  it("stops a waiter on abort, taking nothing and freeing nothing twice", async () => {
    const limiter = new ConnectionLimiter(1);
    const slot = await limiter.acquire();
    const controller = new AbortController();
    const waiting = limiter.acquire(controller.signal);
    const caught = waiting.catch((error: unknown) => error);
    controller.abort();
    expect(await caught).toBeInstanceOf(Error);
    expect(limiter.waiting).toBe(0);
    expect(limiter.held).toBe(1);
    slot.release();
    expect(limiter.held).toBe(0);
    expect((await limiter.acquire()).release).toBeTypeOf("function");
  });

  it("does not take a slot for a signal that is already aborted", async () => {
    const limiter = new ConnectionLimiter(1);
    const controller = new AbortController();
    controller.abort();
    await expect(limiter.acquire(controller.signal)).rejects.toThrow("cancelled while connecting");
    expect(limiter.held).toBe(0);
  });

  it("keeps the slot a waiter was granted before its signal aborted", async () => {
    const limiter = new ConnectionLimiter(1);
    const first = await limiter.acquire();
    const controller = new AbortController();
    const waiting = limiter.acquire(controller.signal);
    first.release();
    const granted = await waiting;
    controller.abort();
    expect(limiter.held).toBe(1);
    granted.release();
    expect(limiter.held).toBe(0);
  });

  it("rejects every waiter when waiting is stopped, leaving held slots alone", async () => {
    const limiter = new ConnectionLimiter(1);
    const slot = await limiter.acquire();
    const waiters = Promise.allSettled([limiter.acquire(), limiter.acquire()]);
    limiter.stopWaiting();
    expect((await waiters).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(limiter.held).toBe(1);
    slot.release();
  });

  it("reports a long wait once the wait outlasts its threshold", async () => {
    const limiter = new ConnectionLimiter(1);
    const slot = await limiter.acquire();
    const onLongWait = vi.fn();
    const waiting = limiter.acquire(undefined, onLongWait, 5);
    await vi.waitFor(() => {
      expect(onLongWait).toHaveBeenCalledTimes(1);
    });
    slot.release();
    (await waiting).release();
    expect(onLongWait).toHaveBeenCalledTimes(1);
  });

  it("cancels the long-wait timer of a wait that ends in time, so it never reports", async () => {
    const THRESHOLD = 987_654;
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      const limiter = new ConnectionLimiter(1);
      const held = await limiter.acquire();
      const onLongWait = vi.fn();
      const waiting = limiter.acquire(undefined, onLongWait, THRESHOLD);
      const index = setSpy.mock.calls.findIndex((call) => call[1] === THRESHOLD);
      expect(index).toBeGreaterThanOrEqual(0);
      const timer = setSpy.mock.results[index]?.value;
      held.release();
      (await waiting).release();
      expect(clearSpy).toHaveBeenCalledWith(timer);
      expect(onLongWait).not.toHaveBeenCalled();
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });
});
