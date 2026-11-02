/**
 * The per-process cap on a remote service's connections (ADR 0007, decision 4): a separate limiter,
 * never the page gate. A slot is taken before `connect` is called and given back with the lease,
 * exactly once, so a connection counts from the moment it is requested until its render has ended.
 * Waiting for a slot ends on the run's cancel and at shutdown, and frees nothing it did not take.
 */
import type { Logger } from "../logger.ts";
import type { RemoteBrowser, RemoteTarget } from "./remote-browser.ts";
import { stoppedError } from "./remote-lease-error.ts";

/** One connection's place under the cap; `release` is safe to call more than once. */
export interface ConnectionSlot {
  release(): void;
}

interface Waiter {
  grant(): void;
  stop(): void;
}

/** A counting semaphore with a FIFO queue whose waiters can be cancelled. */
export class ConnectionLimiter {
  readonly limit: number;
  #held = 0;
  readonly #queue: Waiter[] = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  /** Slots in use. */
  get held(): number {
    return this.#held;
  }

  /** Callers waiting for a slot. */
  get waiting(): number {
    return this.#queue.length;
  }

  /**
   * Take a slot, waiting for one when all are in use. Rejects with the stopped error when `signal`
   * aborts (or the process shuts down) while waiting, without having taken anything.
   * `onLongWait` runs once if the wait outlasts `longWaitMs`.
   */
  async acquire(
    signal?: AbortSignal,
    onLongWait?: () => void,
    longWaitMs = 0,
  ): Promise<ConnectionSlot> {
    if (signal?.aborted === true) {
      throw stoppedError();
    }
    if (this.#held < this.limit && this.#queue.length === 0) {
      this.#held += 1;
      return this.#slot();
    }
    return await new Promise<ConnectionSlot>((resolve, reject) => {
      const timer =
        onLongWait === undefined ? undefined : setTimeout(onLongWait, longWaitMs).unref();
      const settle = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const waiter: Waiter = {
        grant: () => {
          settle();
          this.#held += 1;
          resolve(this.#slot());
        },
        stop: () => {
          settle();
          const index = this.#queue.indexOf(waiter);
          if (index >= 0) {
            this.#queue.splice(index, 1);
          }
          reject(stoppedError());
        },
      };
      const onAbort = (): void => {
        waiter.stop();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#queue.push(waiter);
    });
  }

  /** Reject every waiter (shutdown). Slots already taken are released by their leases. */
  stopWaiting(): void {
    for (const waiter of this.#queue.splice(0)) {
      waiter.stop();
    }
  }

  #slot(): ConnectionSlot {
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.#held -= 1;
        this.#queue.shift()?.grant();
      },
    };
  }
}

const limiters = new Map<RemoteBrowser, ConnectionLimiter>();

/** The limiter of a service, created on first use; undefined when it has no `maxConnections`. */
export function limiterOf(remote: RemoteBrowser): ConnectionLimiter | undefined {
  if (remote.maxConnections === undefined) {
    return undefined;
  }
  let limiter = limiters.get(remote);
  if (limiter === undefined) {
    limiter = new ConnectionLimiter(remote.maxConnections);
    limiters.set(remote, limiter);
  }
  return limiter;
}

/**
 * Take the connection slot of `entry`'s service, or undefined when it has no cap. Not `async`: without
 * a cap the caller must not wait even one tick before it connects. A wait longer than
 * `timeouts.acquireMs` is logged once, with the target and the limit and nothing about the endpoint.
 */
export function takeSlot(
  entry: RemoteTarget,
  signal: AbortSignal | undefined,
  logger: Logger | undefined,
): Promise<ConnectionSlot> | undefined {
  const limiter = limiterOf(entry.remote);
  if (limiter === undefined) {
    return undefined;
  }
  return limiter.acquire(
    signal,
    () => {
      logger?.warn(
        { target: entry.target, limit: limiter.limit, waiting: limiter.waiting },
        "waiting for a remote browser connection slot",
      );
    },
    entry.remote.timeouts.acquireMs,
  );
}

/** Stop every caller still waiting for a slot (shutdown). */
export function stopAllWaiting(): void {
  for (const limiter of limiters.values()) {
    limiter.stopWaiting();
  }
}
