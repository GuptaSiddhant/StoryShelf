import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defineRemote,
  remoteTargetsOf,
  type RemoteLeasedConnection,
  type RemoteOptions,
} from "./remote-browser.ts";
import { connectLeased, shutdownRemote } from "./remote-lease.ts";
import { limiterOf } from "./remote-limiter.ts";
import { refCounted } from "./remote-pool.ts";

const SUPPORT = { engines: ["chromium"], protocols: ["playwright"], label: "remote()" } as const;
const CTX = { buildId: "b1", runId: "s1", purpose: "render" } as const;
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type Lease = { id: number };

/** A service with a counting `connect`/`release`, so a test can see what is held. */
function service(overrides: Partial<RemoteOptions<Lease>> = {}) {
  let next = 0;
  const released: number[] = [];
  const remote = defineRemote<Lease>(
    {
      name: "farm",
      engines: ["chromium"],
      sessions: 2,
      protocol: "playwright",
      reach: "loopback",
      retry: { attempts: 1, backoffMs: 1 },
      connect: async (): Promise<RemoteLeasedConnection<Lease>> => {
        next += 1;
        return await Promise.resolve({
          endpoint: "ws://127.0.0.1:1/secret-path",
          lease: { id: next },
        });
      },
      release: (lease) => {
        released.push(lease.id);
      },
      ...overrides,
    },
    SUPPORT,
  );
  const entry = remoteTargetsOf(remote)[0] as ReturnType<typeof remoteTargetsOf>[number];
  return { entry, released, held: () => limiterOf(entry.remote)?.held ?? 0 };
}

const opens = { open: async () => await Promise.resolve("browser"), reasonOf };

afterEach(async () => {
  await shutdownRemote();
});

describe("maxConnections", () => {
  it("holds the cap while more shards than the cap connect at once, releasing each lease once", async () => {
    const { entry, released, held } = service({ maxConnections: 2 });
    let inFlight = 0;
    let peak = 0;
    // Every lease is held until the cap is full, so reaching it is certain, not a matter of timing.
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const { lease } = await connectLeased(entry, CTX, opens);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        expect(held()).toBeLessThanOrEqual(2);
        if (inFlight === 2) {
          openGate();
        }
        await gate;
        inFlight -= 1;
        await lease.end("finished");
      }),
    );
    expect(peak).toBe(2);
    expect(held()).toBe(0);
    expect(released).toHaveLength(8);
    expect(new Set(released)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it("counts a fixed connection too, and gives its slot back when it ends", async () => {
    const { entry, held } = service({
      connect: { endpoint: "ws://127.0.0.1:2/" },
      release: undefined,
      maxConnections: 1,
    });
    const first = await connectLeased(entry, CTX, opens);
    expect(held()).toBe(1);
    const second = connectLeased(entry, CTX, opens);
    await vi.waitFor(() => {
      expect(limiterOf(entry.remote)?.waiting).toBe(1);
    });
    await first.lease.end("finished");
    const granted = await second;
    expect(held()).toBe(1);
    await granted.lease.end("finished");
    expect(held()).toBe(0);
  });

  it("counts a connection once however many renders share it", async () => {
    const { entry, held } = service({ maxConnections: 1 });
    const shared = await connectLeased(entry, CTX, opens);
    // Many pages on the one connection take nothing more from the cap.
    expect(held()).toBe(1);
    const next = connectLeased(entry, CTX, opens);
    await vi.waitFor(() => {
      expect(limiterOf(entry.remote)?.waiting).toBe(1);
    });
    await shared.lease.end("finished");
    await (await next).lease.end("finished");
    expect(held()).toBe(0);
  });

  it("counts each lease of a reference-counted service once, sharing its one resource", async () => {
    const open = vi.fn(async () => await Promise.resolve({ endpoint: "ws://127.0.0.1:5/" }));
    const pool = refCounted({ open, close: () => {}, idleMs: 60_000, schedule: () => () => {} });
    const { entry, held } = service({
      connect: pool.connect((resource) => resource) as never,
      release: pool.release as never,
      maxConnections: 2,
    });
    const a = await connectLeased(entry, CTX, opens);
    const b = await connectLeased(entry, CTX, opens);
    expect(open).toHaveBeenCalledTimes(1);
    expect(held()).toBe(2);
    const c = connectLeased(entry, CTX, opens);
    await vi.waitFor(() => {
      expect(limiterOf(entry.remote)?.waiting).toBe(1);
    });
    await a.lease.end("finished");
    await Promise.all([b.lease.end("finished"), (await c).lease.end("finished")]);
    expect(held()).toBe(0);
    pool.dispose();
  });

  it("gives the slot back once when the lease ends, however often it is ended", async () => {
    const { entry, released, held } = service({ maxConnections: 1 });
    const { lease } = await connectLeased(entry, CTX, opens);
    await lease.end("finished");
    await lease.end("failed", new Error("late"));
    expect(held()).toBe(0);
    expect(released).toEqual([1]);
    const again = await connectLeased(entry, CTX, opens);
    expect(held()).toBe(1);
    await lease.end("finished");
    expect(held()).toBe(1);
    await again.lease.end("finished");
  });

  it("frees the slot of a handshake that failed before it connects again: never two held for one connection", async () => {
    let tries = 0;
    const { entry, released, held } = service({
      maxConnections: 1,
      retry: { attempts: 2, backoffMs: 1 },
    });
    const { lease } = await connectLeased(entry, CTX, {
      open: async () => {
        tries += 1;
        if (tries === 1) {
          throw new Error("ECONNREFUSED");
        }
        expect(held()).toBe(1);
        return await Promise.resolve("browser");
      },
      reasonOf,
    });
    expect(tries).toBe(2);
    expect(released).toEqual([1]);
    expect(held()).toBe(1);
    await lease.end("finished");
    expect(held()).toBe(0);
  });

  it("frees the slot when connect never returns a connection", async () => {
    const { entry, held } = service({
      maxConnections: 1,
      connect: async () => await Promise.reject(new Error("down")),
      release: undefined,
    });
    await expect(connectLeased(entry, CTX, opens)).rejects.toThrow();
    expect(held()).toBe(0);
  });

  it("ends a wait for a slot when the run is cancelled, freeing nothing it did not take", async () => {
    const { entry, held } = service({ maxConnections: 1 });
    const first = await connectLeased(entry, CTX, opens);
    const controller = new AbortController();
    const waiting = connectLeased(entry, { ...CTX, signal: controller.signal }, opens).catch(
      (error: unknown) => error,
    );
    await vi.waitFor(() => {
      expect(limiterOf(entry.remote)?.waiting).toBe(1);
    });
    controller.abort();
    expect(await waiting).toMatchObject({ name: "TargetLaunchError" });
    expect(limiterOf(entry.remote)?.waiting).toBe(0);
    expect(held()).toBe(1);
    await first.lease.end("finished");
    expect(held()).toBe(0);
    await (await connectLeased(entry, CTX, opens)).lease.end("finished");
    expect(held()).toBe(0);
  });

  it("stops waiters at shutdown", async () => {
    const { entry } = service({ maxConnections: 1 });
    await connectLeased(entry, CTX, opens);
    const waiting = connectLeased(entry, CTX, opens).catch((error: unknown) => error);
    await vi.waitFor(() => {
      expect(limiterOf(entry.remote)?.waiting).toBe(1);
    });
    await shutdownRemote();
    expect(await waiting).toMatchObject({ name: "TargetLaunchError" });
  });

  it("logs a long wait once with the target and limit, never the endpoint", async () => {
    const warn = vi.fn();
    const { entry } = service({ maxConnections: 1, timeouts: { acquireMs: 5 } });
    const first = await connectLeased(entry, CTX, opens);
    const waiting = connectLeased(entry, CTX, { ...opens, logger: { warn } as never });
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledTimes(1);
    });
    const [fields, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toMatchObject({ target: "chromium@farm", limit: 1, waiting: 1 });
    expect(JSON.stringify([fields, message])).not.toContain("secret-path");
    await first.lease.end("finished");
    await (await waiting).lease.end("finished");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("holds no slot after shutdown, so a service used again does not wait on a stale lease", async () => {
    const { entry, held } = service({ maxConnections: 1 });
    await connectLeased(entry, CTX, opens);
    expect(held()).toBe(1);
    await shutdownRemote();
    expect(held()).toBe(0);
    const again = await connectLeased(entry, CTX, opens);
    expect(held()).toBe(1);
    await again.lease.end("finished");
  });

  it("changes nothing without a cap", async () => {
    const { entry, released, held } = service();
    expect(limiterOf(entry.remote)).toBeUndefined();
    const leases = await Promise.all(
      Array.from({ length: 10 }, async () => await connectLeased(entry, CTX, opens)),
    );
    expect(held()).toBe(0);
    await Promise.all(leases.map(async ({ lease }) => await lease.end("finished")));
    expect(released).toHaveLength(10);
  });
});
