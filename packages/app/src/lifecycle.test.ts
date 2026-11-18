import type { ResolvedShelfOptions } from "@storyshelf/core/config";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import type { ShelfRouter } from "./app-types.ts";
import { attachLifecycle, trackBackground, type LifecycleCell } from "./lifecycle.ts";
import type { ServerRuntime } from "./runtime.ts";

const silentLogger = pino({ level: "silent" });

async function throwingSetup(): Promise<void> {
  throw new Error("bad secret");
}

/** A complete auth singleton whose boot check (`setup`) fails. */
function failingAuth() {
  return {
    handler: () => new Response(),
    loginMethods: () => [{ kind: "password", id: "local", label: "Local" }],
    setup: throwingSetup,
    issueInvite: async () => ({}),
    verifyInvite: async () => ({}),
    acceptInvite: async () => ({}),
    passkeysEnabled: () => false,
    listSessions: async () => [],
    listPasskeys: async () => [],
    hasPassword: async () => false,
    setDisabled: async () => {},
    check: async () => null,
    createSession: async () => "",
    destroySession: async () => {},
  };
}

function fakeAdapter(kind: string, setLogger?: (logger: unknown) => void) {
  return {
    metadata: { name: kind, version: "0.0.0", kind, category: "capture-queue" },
    ...(setLogger ? { setLogger } : {}),
  };
}

describe("attachLifecycle", () => {
  it("binds scoped host loggers on adapters that accept them", async () => {
    const setLoggerDb = vi.fn();
    const setLoggerQueue = vi.fn();
    const options = {
      database: fakeAdapter("postgres", setLoggerDb),
      storage: fakeAdapter("local"),
      captureRunner: fakeAdapter("sqs", setLoggerQueue),
    } as unknown as ResolvedShelfOptions;
    const runtime = {
      config: { branchTtlDays: null },
      logger: silentLogger,
    } as unknown as ServerRuntime;
    const cell: LifecycleCell = {
      ready: Promise.resolve({ ok: true, failures: [] }),
      settled: null,
    };
    attachLifecycle({} as ShelfRouter, options, runtime, cell);
    expect(setLoggerDb).toHaveBeenCalledOnce();
    expect(setLoggerQueue).toHaveBeenCalledOnce();
    const bound = setLoggerQueue.mock.calls[0]?.[0] as {
      bindings?: () => Record<string, unknown>;
    };
    expect(bound.bindings?.()).toMatchObject({ component: "sqs" });
    await cell.ready;
  });

  it("fails readiness without running hooks when an adapter is invalid", async () => {
    const { db } = makeDatabase();
    const broken = {
      metadata: { name: "", version: "", kind: "", category: "storage" },
      read: async () => Buffer.from(""),
    };
    const options = {
      database: db,
      storage: broken,
    } as unknown as ResolvedShelfOptions;
    const runtime = {
      config: { branchTtlDays: null },
      logger: silentLogger,
    } as unknown as ServerRuntime;
    const cell: LifecycleCell = {
      ready: Promise.resolve({ ok: true, failures: [] }),
      settled: null,
    };
    const app = {} as ShelfRouter;
    attachLifecycle(app, options, runtime, cell);
    const result = await cell.ready;
    expect(result.ok).toBe(false);
    expect(result.failures[0]?.category).toBe("storage");
    const lifecycle = (app as unknown as { lifecycle: { setup(): Promise<void> } }).lifecycle;
    await expect(lifecycle.setup()).rejects.toThrow("Adapter setup failed");
  });

  it("preserves the auth setup cause in readiness failures", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const options = {
      database: db,
      storage,
      auth: failingAuth(),
    } as unknown as ResolvedShelfOptions;
    const runtime = {
      config: { branchTtlDays: null },
      logger: silentLogger,
    } as unknown as ServerRuntime;
    const cell: LifecycleCell = {
      ready: Promise.resolve({ ok: true, failures: [] }),
      settled: null,
    };
    attachLifecycle({} as ShelfRouter, options, runtime, cell);
    const result = await cell.ready;
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatchObject({ category: "auth", error: "bad secret" });
  });

  it("refuses setup() when the auth boot check failed, instead of continuing", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const options = {
      database: db,
      storage,
      auth: failingAuth(),
    } as unknown as ResolvedShelfOptions;
    const runtime = {
      config: { branchTtlDays: null },
      logger: silentLogger,
    } as unknown as ServerRuntime;
    const cell: LifecycleCell = {
      ready: Promise.resolve({ ok: true, failures: [] }),
      settled: null,
    };
    const app = {} as ShelfRouter;
    attachLifecycle(app, options, runtime, cell);
    const lifecycle = (app as unknown as { lifecycle: { setup(): Promise<void> } }).lifecycle;
    await expect(lifecycle.setup()).rejects.toThrow("Adapter setup failed: auth/auth");
    // A second call refuses too, and readiness stays failed (no later adapter run masks it).
    await expect(lifecycle.setup()).rejects.toThrow("auth/auth");
    // The hook's own text stays in the failures (and the log), never the thrown message.
    await expect(lifecycle.setup()).rejects.not.toThrow("bad secret");
    expect(cell.settled?.ok).toBe(false);
    expect((await cell.ready).failures[0]).toMatchObject({ category: "auth" });
  });
});

function boot(torn: string[]) {
  const closing = (name: string) => ({
    ...fakeAdapter(name),
    lifecycle: {
      setup: async (): Promise<void> => {},
      teardown: async (): Promise<void> => {
        torn.push(name);
      },
      health: async () => ({ ok: true }),
    },
  });
  const options = {
    database: closing("db"),
    storage: closing("storage"),
  } as unknown as ResolvedShelfOptions;
  const runtime = {
    config: { branchTtlDays: null },
    logger: silentLogger,
  } as unknown as ServerRuntime;
  const cell: LifecycleCell = {
    ready: Promise.resolve({ ok: true, failures: [] }),
    settled: null,
  };
  const app = {} as ShelfRouter;
  attachLifecycle(app, options, runtime, cell);
  const lifecycle = (app as unknown as { lifecycle: { teardown(): Promise<void> } }).lifecycle;
  return { cell, lifecycle };
}

describe("teardown and background boot tasks", () => {
  it("waits for tracked boot tasks before closing adapters", async () => {
    const order: string[] = [];
    const { cell, lifecycle } = boot(order);
    const recovery = Promise.withResolvers<null>();
    trackBackground(cell, recovery.promise);
    const done = lifecycle.teardown();
    await Promise.resolve();
    expect(order).toEqual([]);
    order.push("recovery done");
    recovery.resolve(null);
    await done;
    expect(order[0]).toBe("recovery done");
    expect(order).toContain("db");
  });

  it("does not let a failed boot task block shutdown", async () => {
    const order: string[] = [];
    const { cell, lifecycle } = boot(order);
    trackBackground(cell, Promise.reject(new Error("recovery blew up")));
    await lifecycle.teardown();
    expect(order).toContain("db");
  });

  it("stops waiting for a hung boot task after the drain timeout", async () => {
    const order: string[] = [];
    const { cell, lifecycle } = boot(order);
    cell.drainMs = 20;
    trackBackground(cell, new Promise(() => {}));
    await lifecycle.teardown();
    expect(order).toContain("db");
  });
});

function fakeConsumer() {
  const stopped = Promise.withResolvers<null>();
  let running = false;
  return {
    start: vi.fn(async () => {
      running = true;
      await stopped.promise;
      running = false;
    }),
    stop: vi.fn(async () => {
      stopped.resolve(null);
      await Promise.resolve();
    }),
    isRunning: () => running,
  };
}

function lifecycleOf(consumer: ReturnType<typeof fakeConsumer> | null) {
  const { db } = makeDatabase();
  const { storage } = makeStorage();
  const options = { database: db, storage } as unknown as ResolvedShelfOptions;
  const runtime = {
    config: { branchTtlDays: null },
    logger: silentLogger,
  } as unknown as ServerRuntime;
  const cell: LifecycleCell = {
    ready: Promise.resolve({ ok: true, failures: [] }),
    settled: null,
    consumer,
  };
  const app = {} as ShelfRouter;
  attachLifecycle(app, options, runtime, cell);
  return (app as unknown as { lifecycle: { setup(): Promise<void>; teardown(): Promise<void> } })
    .lifecycle;
}

describe("setup rerun", () => {
  it("publishes the new run on the cell before it finishes", async () => {
    const { db } = makeDatabase();
    const hold = Promise.withResolvers<null>();
    let calls = 0;
    const storage = {
      ...makeStorage().storage,
      setup: async (): Promise<void> => {
        calls += 1;
        if (calls > 1) await hold.promise;
      },
    };
    const options = { database: db, storage } as unknown as ResolvedShelfOptions;
    const runtime = {
      config: { branchTtlDays: null },
      logger: silentLogger,
    } as unknown as ServerRuntime;
    const cell: LifecycleCell = {
      ready: Promise.resolve({ ok: true, failures: [] }),
      settled: null,
    };
    const app = {} as ShelfRouter;
    attachLifecycle(app, options, runtime, cell);
    await cell.ready;
    const lifecycle = (app as unknown as { lifecycle: { setup(): Promise<void> } }).lifecycle;

    const rerun = lifecycle.setup();
    const published = cell.ready;
    let settled = false;
    const observed = published.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    hold.resolve(null);
    await rerun;
    await observed;
    expect(settled).toBe(true);
  });
});

describe("job consumer lifecycle", () => {
  it("starts after setup, once, and drains on teardown", async () => {
    const consumer = fakeConsumer();
    const lifecycle = lifecycleOf(consumer);
    expect(consumer.start).not.toHaveBeenCalled();
    await lifecycle.setup();
    await lifecycle.setup();
    expect(consumer.start).toHaveBeenCalledOnce();
    await lifecycle.teardown();
    expect(consumer.stop).toHaveBeenCalledOnce();
    expect(consumer.isRunning()).toBe(false);
  });

  it("works without a consumer (serverless hosts)", async () => {
    const lifecycle = lifecycleOf(null);
    await lifecycle.setup();
    await expect(lifecycle.teardown()).resolves.toBeUndefined();
  });

  it("logs a consumer that fails to start instead of failing setup", async () => {
    const consumer = fakeConsumer();
    consumer.start.mockRejectedValueOnce(new Error("engine"));
    const lifecycle = lifecycleOf(consumer);
    await expect(lifecycle.setup()).resolves.toBeUndefined();
    await expect(lifecycle.teardown()).resolves.toBeUndefined();
  });
});

/** The adapter with a `lifecycle.setup` hook that calls `onSetup`. */
function withSetupHook<T extends object>(
  adapter: T,
  onSetup: () => Promise<void> | void,
  onTeardown: () => void = () => {},
): T {
  return {
    ...adapter,
    lifecycle: {
      setup: async (): Promise<void> => {
        await onSetup();
      },
      teardown: async (): Promise<void> => {
        onTeardown();
      },
      health: async () => ({ ok: true }),
    },
  };
}

describe("boot checks and the adapter phase", () => {
  const runtime = {
    config: { branchTtlDays: null },
    logger: silentLogger,
  } as unknown as ServerRuntime;

  it("runs the AI purge only after the adapter setups (migrations) finished", async () => {
    const order: string[] = [];
    const { db } = makeDatabase();
    const list = db.list.bind(db);
    Object.assign(db, {
      list: async (...args: Parameters<typeof db.list>) => {
        order.push("query");
        return await list(...args);
      },
    });
    const storage = withSetupHook(makeStorage().storage, () => {
      order.push("migrate");
    });
    const ai = {
      setup: async (): Promise<void> => {
        order.push("ai check");
      },
      teardown: async (): Promise<void> => {},
    };
    const options = { database: db, storage, ai } as unknown as ResolvedShelfOptions;
    const cell: LifecycleCell = {
      ready: Promise.resolve({ ok: true, failures: [] }),
      settled: null,
    };
    attachLifecycle({} as ShelfRouter, options, runtime, cell);
    await cell.ready;
    expect(order.indexOf("ai check")).toBeLessThan(order.indexOf("migrate"));
    expect(order.indexOf("migrate")).toBeLessThan(order.lastIndexOf("query"));
  });

  it("does not resume a setup() whose boot checks settle after teardown", async () => {
    const gate = Promise.withResolvers<null>();
    let adapterRuns = 0;
    const { db } = makeDatabase();
    const auth = {
      ...failingAuth(),
      setup: async (): Promise<void> => {
        await gate.promise;
      },
    };
    const storage = withSetupHook(makeStorage().storage, () => {
      adapterRuns += 1;
    });
    const options = { database: db, storage, auth } as unknown as ResolvedShelfOptions;
    const cell: LifecycleCell = {
      ready: Promise.resolve({ ok: true, failures: [] }),
      settled: null,
    };
    const app = {} as ShelfRouter;
    attachLifecycle(app, options, runtime, cell);
    const lifecycle = (
      app as unknown as { lifecycle: { setup(): Promise<void>; teardown(): Promise<void> } }
    ).lifecycle;
    const pending = lifecycle.setup();
    const closing = lifecycle.teardown();
    gate.resolve(null);
    await expect(pending).rejects.toThrow("teardown ran");
    await closing;
    await cell.ready;
    // Neither the eager boot run nor the abandoned setup() reached the closed adapters.
    expect(adapterRuns).toBe(0);
  });

  it("drains an in-flight setup() rerun before teardown and never restarts the consumer", async () => {
    const gate = Promise.withResolvers<null>();
    const order: string[] = [];
    let runs = 0;
    const { db } = makeDatabase();
    const storage = withSetupHook(
      makeStorage().storage,
      async () => {
        runs += 1;
        if (runs === 2) {
          await gate.promise;
        }
        order.push(`setup ${runs}`);
      },
      () => order.push("teardown"),
    );
    const options = { database: db, storage } as unknown as ResolvedShelfOptions;
    const consumer = { isRunning: () => false, start: vi.fn(async () => {}), stop: async () => {} };
    const cell: LifecycleCell = {
      ready: Promise.resolve({ ok: true, failures: [] }),
      settled: null,
      consumer: consumer as unknown as LifecycleCell["consumer"],
    };
    const app = {} as ShelfRouter;
    attachLifecycle(app, options, runtime, cell);
    const lifecycle = (
      app as unknown as { lifecycle: { setup(): Promise<void>; teardown(): Promise<void> } }
    ).lifecycle;
    await cell.ready;
    const pending = lifecycle.setup();
    const closing = lifecycle.teardown();
    gate.resolve(null);
    await expect(pending).rejects.toThrow("teardown ran");
    await closing;
    // The rerun's hook finished before the adapters were torn down, and nothing restarted polling.
    expect(order).toEqual(["setup 1", "setup 2", "teardown"]);
    expect(consumer.start).not.toHaveBeenCalled();
  });
});
