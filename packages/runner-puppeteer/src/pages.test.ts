import { afterEach, describe, expect, it, vi } from "vitest";
import { PagePool, clearBrowserState } from "./pages.ts";

const VIEWPORT = { name: "desktop", width: 800, height: 600 };

/** Rebuild the function from its source in a scope without module bindings, as `page.evaluate` ships it. */
function asSerialized<T extends (...args: never[]) => unknown>(fn: T): T {
  // oxlint-disable-next-line typescript/no-implied-eval, eslint/no-new-func -- the point is to rebuild the function from source
  return new Function(`return (${fn.toString()})`)() as T;
}

/** What a story page holds for its origin, behind the browser APIs the reset talks to. */
function stubOrigin(options: { withCaches?: boolean; withWorkers?: boolean } = {}) {
  const withCaches = options.withCaches ?? true;
  const withWorkers = options.withWorkers ?? true;
  const state = {
    local: 1,
    session: 1,
    databases: ["storybook"],
    deleted: [] as string[],
    caches: new Set(["sb-runtime", "sb-assets"]),
    workers: [{ unregistered: false }, { unregistered: false }],
  };
  vi.stubGlobal("localStorage", {
    clear: () => {
      state.local = 0;
    },
  });
  vi.stubGlobal("sessionStorage", {
    clear: () => {
      state.session = 0;
    },
  });
  vi.stubGlobal("indexedDB", {
    databases: async () => await Promise.resolve(state.databases.map((name) => ({ name }))),
    deleteDatabase: (name: string) => {
      state.deleted.push(name);
    },
  });
  vi.stubGlobal(
    "caches",
    withCaches
      ? {
          keys: async () => await Promise.resolve([...state.caches]),
          delete: async (name: string) => await Promise.resolve(state.caches.delete(name)),
        }
      : undefined,
  );
  vi.stubGlobal(
    "navigator",
    withWorkers
      ? {
          serviceWorker: {
            getRegistrations: async () =>
              await Promise.resolve(
                state.workers.map((worker) => ({
                  unregister: async () => {
                    worker.unregistered = true;
                    return await Promise.resolve(true);
                  },
                })),
              ),
          },
        }
      : {},
  );
  return state;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clearBrowserState (as serialized)", () => {
  const clear = asSerialized(clearBrowserState);

  it("empties web storage, IndexedDB, Cache Storage and service workers", async () => {
    const origin = stubOrigin();
    await clear();
    expect(origin.local).toBe(0);
    expect(origin.session).toBe(0);
    expect(origin.deleted).toEqual(["storybook"]);
    expect([...origin.caches]).toEqual([]);
    expect(origin.workers.map((worker) => worker.unregistered)).toEqual([true, true]);
  });

  it("copes with a page that has no Cache Storage or service workers (an insecure origin)", async () => {
    const origin = stubOrigin({ withCaches: false, withWorkers: false });
    await expect(clear()).resolves.toBeUndefined();
    expect(origin.local).toBe(0);
  });
});

function makePage() {
  return {
    setViewport: async (): Promise<void> => {
      await Promise.resolve();
    },
    evaluateOnNewDocument: async (): Promise<void> => {
      await Promise.resolve();
    },
    evaluate: vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    }),
    goto: vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    }),
  };
}

function entryStubs() {
  const contexts: {
    page: ReturnType<typeof makePage>;
    closed: boolean;
    deleted: number;
    forgotten: boolean;
  }[] = [];
  const session = {
    createBrowserContext: async () => {
      const page = makePage();
      const record = { page, closed: false, deleted: 0, forgotten: false };
      contexts.push(record);
      const context = {
        newPage: async () => await Promise.resolve(page),
        cookies: async () => await Promise.resolve([{ name: "a" }]),
        deleteCookie: async () => {
          record.deleted += 1;
          await Promise.resolve();
        },
        close: async () => {
          record.closed = true;
          await Promise.resolve();
        },
      };
      return await Promise.resolve(context);
    },
    forgetContext: () => {
      const last = contexts.findLast((record) => record.closed && !record.forgotten);
      if (last) last.forgotten = true;
    },
  };
  return { session, contexts };
}

describe("PagePool", () => {
  it("resets a page after a good capture and hands the same page to the next one", async () => {
    const { session, contexts } = entryStubs();
    const pool = new PagePool(session as never);
    const first = await pool.acquire(VIEWPORT);
    await first.release(true);
    const second = await pool.acquire(VIEWPORT);
    expect(second.page).toBe(first.page);
    expect(contexts).toHaveLength(1);
    const record = contexts[0];
    expect(record?.deleted).toBe(1);
    expect(record?.page.goto).toHaveBeenCalledWith("about:blank");
    expect(record?.page.evaluate).toHaveBeenCalledWith(clearBrowserState);
    expect(record?.closed).toBe(false);
  });

  it("discards, never reuses, a page whose reset failed", async () => {
    const { session, contexts } = entryStubs();
    const pool = new PagePool(session as never);
    const first = await pool.acquire(VIEWPORT);
    contexts[0]?.page.evaluate.mockRejectedValueOnce(new Error("reset failed"));
    await first.release(true);
    expect(contexts[0]?.closed).toBe(true);
    const second = await pool.acquire(VIEWPORT);
    expect(second.page).not.toBe(first.page);
    expect(contexts).toHaveLength(2);
  });

  it("discards a page after a failed capture without resetting it", async () => {
    const { session, contexts } = entryStubs();
    const pool = new PagePool(session as never);
    const lease = await pool.acquire(VIEWPORT);
    await lease.release(false);
    expect(contexts[0]?.closed).toBe(true);
    expect(contexts[0]?.page.evaluate).not.toHaveBeenCalled();
  });

  it("closes every idle page on dispose", async () => {
    const { session, contexts } = entryStubs();
    const pool = new PagePool(session as never);
    const leases = await Promise.all([pool.acquire(VIEWPORT), pool.acquire(VIEWPORT)]);
    await Promise.all(leases.map(async (lease) => await lease.release(true)));
    await pool.dispose();
    expect(contexts.map((record) => record.closed)).toEqual([true, true]);
  });
});
