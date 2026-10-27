/**
 * A shared resource behind a remote service, opened by the first connection and closed once the
 * last one has been idle for a while: a computer woken for the builds' shards and suspended after
 * (ADR 0007, decision 4). One pool per service; its connections share the resource.
 */
import type { Logger } from "../logger.ts";
import type {
  RemoteConnectContext,
  RemoteConnection,
  RemoteLeasedConnection,
  RemoteReleaseInfo,
} from "./remote-browser.ts";
import { onRemoteShutdown } from "./remote-lease.ts";

/** Options of {@link refCounted}. */
export interface RefCountedOptions<TResource> {
  /**
   * Start the resource (wake the computer) and return what connections need of it. Called by the
   * first connection; concurrent first connections share the call. Must be idempotent: it runs
   * again after a failed `close`, and may overlap a `close` that timed out. `signal` aborts when
   * every waiting connection was cancelled, and at shutdown: clean up after yourself when it does,
   * or throw an error with a `resource` property so the pool closes it.
   */
  open: (context: RemoteConnectContext, signal: AbortSignal) => Promise<TResource>;
  /** Stop the resource (suspend the computer). */
  close: (resource: TResource) => Promise<void> | void;
  /**
   * How long the resource stays open with no connection, in ms. Required: set it longer than the
   * gap between a build's passes (the extract and tests pre-passes and its shards connect close
   * together), for example 120 000.
   */
  idleMs: number;
  /** How long `close` may take in ms before it counts as failed (default 30 000). */
  closeTimeoutMs?: number | undefined;
  /** Where close failures go (error class only, never the message). */
  logger?: Logger | undefined;
  /**
   * Runs `run` after `ms` and returns what cancels it (default: an unref'd `setTimeout`). A seam
   * for tests to drive the idle timer without real time.
   */
  schedule?: ((run: () => void, ms: number) => () => void) | undefined;
}

/** What the pool hands to `release`: an opaque token for one connection. */
export interface PoolLease {
  readonly pool: "refCounted";
}

/** A reference-counted resource, wired into a service's `connect` and `release`. */
export interface RefCounted<TResource> {
  /** Build the service's `connect`: `build` gets the shared resource and returns the connection. */
  connect(
    build: (
      resource: TResource,
      context: RemoteConnectContext,
    ) => RemoteConnection | Promise<RemoteConnection>,
  ): (context: RemoteConnectContext) => Promise<RemoteLeasedConnection<PoolLease>>;
  /** The service's `release`. */
  release(lease: PoolLease, info: RemoteReleaseInfo): Promise<void>;
  /** Close now: abort a pending `open`, then close the resource. Runs at shutdown. */
  flush(): Promise<void>;
  /** Unregister from shutdown and drop the idle timer, without closing (for tests). */
  dispose(): void;
}

type State = "idle" | "opening" | "open" | "closing" | "unknown";

interface Slot<TResource> {
  resource: TResource;
  count: number;
}

/**
 * Share one resource between connections: opened by the first, closed `idleMs` after the last
 * was released (or at once on shutdown). A connection arriving while it closes waits, then opens it
 * again. After a failed `close` the resource is `unknown`: the next connection opens it again and
 * the idle timer retries the close.
 */
export function refCounted<TResource>(
  options: RefCountedOptions<TResource>,
): RefCounted<TResource> {
  const pool = new Pool(options);
  const unregister = onRemoteShutdown(async () => {
    await pool.flush();
  });
  return {
    connect: (build) => async (context) => {
      const slot = await pool.take(context);
      try {
        const connection = await build(slot.resource, context);
        return { ...connection, lease: slot as unknown as PoolLease };
      } catch (error) {
        pool.give(slot);
        throw error;
      }
    },
    release: async (lease) => {
      pool.give(lease as unknown as Slot<TResource>);
      await Promise.resolve();
    },
    flush: async () => {
      await pool.flush();
    },
    dispose: () => {
      unregister();
      pool.dispose();
    },
  };
}

class Pool<TResource> {
  #state: State = "idle";
  #slot: Slot<TResource> | undefined;
  #stale: TResource | undefined;
  #hasStale = false;
  #cancelIdle: (() => void) | undefined;
  #opening: Promise<void> | undefined;
  #openController: AbortController | undefined;
  #waiters = new Set<AbortSignal>();
  #closing: Promise<void> | undefined;
  readonly #options: RefCountedOptions<TResource>;

  constructor(options: RefCountedOptions<TResource>) {
    this.#options = options;
  }

  /** A connection's share of the resource, opening it first when nobody has. */
  async take(context: RemoteConnectContext): Promise<Slot<TResource>> {
    for (;;) {
      if (this.#state === "closing") {
        // oxlint-disable-next-line eslint/no-await-in-loop -- a connection waits for the close to end
        await this.#closing?.catch(() => {});
      } else if (this.#state === "opening") {
        // oxlint-disable-next-line eslint/no-await-in-loop -- waiters share the one open
        await this.#waitOpen(context.signal);
      } else if (this.#state === "open" && this.#slot !== undefined) {
        this.#clearIdle();
        this.#slot.count += 1;
        return this.#slot;
      } else {
        this.#startOpen(context);
      }
    }
  }

  /** A connection is done with its slot; the last one starts the idle timer. */
  give(slot: Slot<TResource>): void {
    slot.count = Math.max(0, slot.count - 1);
    if (slot === this.#slot && slot.count === 0 && this.#state === "open") {
      this.#armIdle();
    }
  }

  /** Close now, aborting a pending open first. */
  async flush(): Promise<void> {
    this.#clearIdle();
    this.#openController?.abort();
    await this.#opening?.catch(() => {});
    if (this.#state === "closing") {
      await this.#closing?.catch(() => {});
    }
    if (this.#state === "open" || this.#state === "unknown") {
      await this.#close();
    }
  }

  dispose(): void {
    this.#clearIdle();
  }

  #startOpen(context: RemoteConnectContext): void {
    this.#clearIdle();
    const controller = new AbortController();
    this.#openController = controller;
    this.#state = "opening";
    this.#opening = this.#options
      .open(context, controller.signal)
      .then(
        (resource) => {
          this.#slot = { resource, count: 0 };
          this.#hasStale = false;
          this.#stale = undefined;
          this.#state = "open";
        },
        async (error: unknown) => {
          this.#state = this.#hasStale ? "unknown" : "idle";
          if (this.#hasStale) {
            // Reopening cancelled the retry of the failed close; it is still owed.
            this.#armIdle();
          }
          await this.#closeLeftover(error);
          throw error;
        },
      )
      .finally(() => {
        this.#openController = undefined;
        this.#waiters.clear();
      });
    // The first waiter is the caller that started it.
    this.#opening.catch(() => {});
    this.#waitOpen(context.signal).catch(() => {});
  }

  /** Wait for the open in flight; it is aborted once every waiter has given up. */
  async #waitOpen(signal: AbortSignal): Promise<void> {
    this.#waiters.add(signal);
    const onAbort = (): void => {
      this.#waiters.delete(signal);
      if (this.#waiters.size === 0) {
        this.#openController?.abort();
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await this.#opening;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  #armIdle(): void {
    this.#clearIdle();
    const schedule = this.#options.schedule ?? scheduleTimeout;
    this.#cancelIdle = schedule(() => {
      if ((this.#slot?.count ?? 0) === 0) {
        this.#close().catch(() => {});
      }
    }, this.#options.idleMs);
  }

  #clearIdle(): void {
    this.#cancelIdle?.();
    this.#cancelIdle = undefined;
  }

  async #close(): Promise<void> {
    const resource = this.#slot?.resource ?? this.#stale;
    if (resource === undefined || this.#state === "closing") {
      return;
    }
    this.#state = "closing";
    this.#closing = this.#runClose(resource);
    await this.#closing;
  }

  async #runClose(resource: TResource): Promise<void> {
    try {
      await timed(async () => {
        await this.#options.close(resource);
      }, this.#options.closeTimeoutMs ?? 30_000);
      this.#settle("idle");
    } catch (error) {
      // The suspend may have worked on the server: keep the reference, but trust nothing about it.
      this.#settle("unknown", resource);
      this.#options.logger?.warn(
        { err: error instanceof Error ? error.name : "Error" },
        "remote pool close failed, will retry after the idle period",
      );
      this.#armIdle();
    }
  }

  /** After a close: `idle` with nothing, or `unknown` holding the resource to close again. */
  #settle(state: "idle" | "unknown", stale?: TResource): void {
    this.#slot = undefined;
    this.#stale = stale;
    this.#hasStale = state === "unknown";
    this.#state = state;
  }

  /** An `open` that failed after starting something may name it, so it is not left running. */
  async #closeLeftover(error: unknown): Promise<void> {
    const leftover = (error as { resource?: TResource } | null)?.resource;
    if (leftover === undefined) {
      return;
    }
    try {
      await timed(async () => {
        await this.#options.close(leftover);
      }, this.#options.closeTimeoutMs ?? 30_000);
    } catch (closeError) {
      this.#options.logger?.warn(
        { err: closeError instanceof Error ? closeError.name : "Error" },
        "remote pool close failed after a failed open",
      );
    }
  }
}

/** The default scheduler: an unref'd timer, so an idle pool never keeps the process alive. */
function scheduleTimeout(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
}

async function timed(run: () => Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(`close timed out after ${ms} ms`), { name: "CloseTimeout" }));
    }, ms);
  });
  try {
    await Promise.race([run(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
