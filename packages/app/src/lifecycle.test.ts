import type { ShelfOptions } from "@storyshelf/core/config";
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
      captureQueue: fakeAdapter("sqs", setLoggerQueue),
    } as unknown as ShelfOptions;
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
    } as unknown as ShelfOptions;
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
      auth: {
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
      },
    } as unknown as ShelfOptions;
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
  } as unknown as ShelfOptions;
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
