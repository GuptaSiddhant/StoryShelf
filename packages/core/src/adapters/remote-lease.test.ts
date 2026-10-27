import { describe, expect, it, vi } from "vitest";
import { TargetLaunchError } from "./capture-target.ts";
import { defineRemote, remoteTargetsOf, type RemoteOptions } from "./remote-browser.ts";
import { connectLeased, releaseAllLeases } from "./remote-lease.ts";

const SUPPORT = { engines: ["chromium"], protocols: ["playwright"], label: "remote()" } as const;
const CTX = { buildId: "b1", shardIndex: 2 };
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function entryOf(options: Partial<RemoteOptions>) {
  const remote = defineRemote(
    {
      name: "farm",
      engines: ["chromium"],
      sessions: 2,
      connectRetries: 2,
      connectBackoffMs: 1,
      connect: () => ({
        protocol: "playwright",
        endpoint: "ws://127.0.0.1:1/",
        exposeNetwork: "<loopback>",
      }),
      ...options,
    },
    SUPPORT,
  );
  return remoteTargetsOf(remote)[0] as ReturnType<typeof remoteTargetsOf>[number];
}

const acquired = (id: string) => ({
  protocol: "playwright" as const,
  endpoint: `ws://127.0.0.1:${id}/secret-path`,
  exposeNetwork: "<loopback>",
  lease: { id, token: "lease-token" },
});

describe("connectLeased", () => {
  it("acquires with the render's identity, opens the leased connection and releases once", async () => {
    const acquire = vi.fn(async () => await Promise.resolve(acquired("a")));
    const release = vi.fn();
    const open = vi.fn(async (_connection: unknown) => await Promise.resolve("browser"));
    const { value, lease } = await connectLeased(entryOf({ acquire, release }), CTX, {
      open,
      reasonOf,
    });
    expect(value).toBe("browser");
    expect(acquire).toHaveBeenCalledWith({ engine: "chromium", buildId: "b1", shardIndex: 2 });
    expect((open.mock.calls as unknown as [unknown][])[0]?.[0]).toMatchObject({
      endpoint: "ws://127.0.0.1:a/secret-path",
    });
    expect(release).not.toHaveBeenCalled();
    await lease.end("finished");
    await lease.end("failed");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith({ id: "a", token: "lease-token" }, "finished");
  });

  it("without acquire, connects with connect() and holds nothing", async () => {
    const open = vi.fn(async () => await Promise.resolve(1));
    const { lease } = await connectLeased(entryOf({}), CTX, { open, reasonOf });
    await expect(lease.end("finished")).resolves.toBeUndefined();
  });

  it("gives concurrent shards distinct leases, each released once", async () => {
    let next = 0;
    const acquire = vi.fn(async () => await Promise.resolve(acquired(String((next += 1)))));
    const release = vi.fn();
    const entry = entryOf({ acquire, release });
    const opened = await Promise.all(
      [1, 2, 3].map(
        async (shardIndex) =>
          await connectLeased(
            entry,
            { buildId: "b1", shardIndex },
            { open: async (c) => await Promise.resolve(c.endpoint), reasonOf },
          ),
      ),
    );
    expect(new Set(opened.map((o) => o.value)).size).toBe(3);
    await Promise.all(opened.map(async (o) => await o.lease.end("finished")));
    expect(release).toHaveBeenCalledTimes(3);
  });

  it("releases a lease whose handshake failed as failed, then acquires again for the retry", async () => {
    let next = 0;
    const acquire = vi.fn(async () => await Promise.resolve(acquired(String((next += 1)))));
    const release = vi.fn();
    const open = vi
      .fn<(c: unknown) => Promise<string>>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce("ok");
    const { lease } = await connectLeased(entryOf({ acquire, release }), CTX, { open, reasonOf });
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[1]).toBe("failed");
    await lease.end("finished");
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("leaks no lease when the handshake never succeeds", async () => {
    const acquire = vi.fn(async () => await Promise.resolve(acquired("x")));
    const release = vi.fn();
    const open = vi.fn(async () => await Promise.reject(new Error("401 Unauthorized")));
    const error = (await connectLeased(entryOf({ acquire, release }), CTX, {
      open,
      reasonOf,
    }).catch((caught: unknown) => caught)) as TargetLaunchError;
    expect(error).toBeInstanceOf(TargetLaunchError);
    expect(error.transient).toBe(false);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("retries a throwing acquire and ends as a transient launch error with a clear reason", async () => {
    const acquire = vi.fn(async () => await Promise.reject(new Error("wake failed")));
    const release = vi.fn();
    const open = vi.fn();
    const error = (await connectLeased(entryOf({ acquire, release }), CTX, {
      open,
      reasonOf,
    }).catch((caught: unknown) => caught)) as TargetLaunchError;
    expect(acquire).toHaveBeenCalledTimes(3);
    expect(open).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(error.transient).toBe(true);
    expect(error.reason).toBe("acquire failed: wake failed");
  });

  it("does not retry an acquire error that says transient: false", async () => {
    const acquire = vi.fn(
      async () =>
        await Promise.reject(Object.assign(new Error("computer gone"), { transient: false })),
    );
    const error = (await connectLeased(entryOf({ acquire }), CTX, {
      open: vi.fn(),
      reasonOf,
    }).catch((caught: unknown) => caught)) as TargetLaunchError;
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(error.transient).toBe(false);
  });

  it("times acquire out, and releases a lease that arrives late", async () => {
    const release = vi.fn();
    const acquire = vi.fn(
      async () =>
        await new Promise<ReturnType<typeof acquired>>((resolve) => {
          setTimeout(() => {
            resolve(acquired("late"));
          }, 30);
        }),
    );
    const entry = entryOf({ acquire, release, acquireTimeoutMs: 5, connectRetries: 0 });
    const error = (await connectLeased(entry, CTX, { open: vi.fn(), reasonOf }).catch(
      (caught: unknown) => caught,
    )) as TargetLaunchError;
    expect(error.reason).toContain("acquire timed out after 5 ms");
    expect(error.transient).toBe(true);
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledWith({ id: "late", token: "lease-token" }, "failed");
    });
  });

  it("refuses a connection whose reach differs from connect(), releasing it", async () => {
    const release = vi.fn();
    const acquire = vi.fn(
      async () =>
        await Promise.resolve({ protocol: "playwright" as const, endpoint: "ws://h:1/", lease: 1 }),
    );
    const error = (await connectLeased(entryOf({ acquire, release }), CTX, {
      open: vi.fn(),
      reasonOf,
    }).catch((caught: unknown) => caught)) as TargetLaunchError;
    expect(error.transient).toBe(false);
    expect(error.reason).toContain("reach");
    expect(release).toHaveBeenCalledWith(1, "failed");
  });

  it("logs a failing release without the lease and does not throw", async () => {
    const warn = vi.fn();
    const release = vi.fn(() => {
      throw new Error("sleep failed token=lease-token");
    });
    const acquire = vi.fn(async () => await Promise.resolve(acquired("a")));
    const { lease } = await connectLeased(entryOf({ acquire, release }), CTX, {
      open: async () => await Promise.resolve(1),
      reasonOf,
      logger: { warn } as never,
    });
    await expect(lease.end("finished")).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("lease-token");
  });

  it("releases every held lease as cancelled on shutdown", async () => {
    const release = vi.fn();
    const acquire = vi.fn(async () => await Promise.resolve(acquired("s")));
    await connectLeased(entryOf({ acquire, release }), CTX, {
      open: async () => await Promise.resolve(1),
      reasonOf,
    });
    await releaseAllLeases();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[1]).toBe("cancelled");
    await releaseAllLeases();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
