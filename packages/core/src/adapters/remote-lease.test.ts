import { afterEach, describe, expect, it, vi } from "vitest";
import { TargetLaunchError } from "./capture-target.ts";
import {
  defineRemote,
  remoteTargetsOf,
  type RemoteConnectContext,
  type RemoteLeasedConnection,
  type RemoteOptions,
} from "./remote-browser.ts";
import {
  RemoteConnectError,
  connectLeased,
  onRemoteShutdown,
  shutdownRemote,
} from "./remote-lease.ts";

const SUPPORT = { engines: ["chromium"], protocols: ["playwright"], label: "remote()" } as const;
const CTX = { buildId: "b1", runId: "s2", shardIndex: 2, purpose: "render" } as const;
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type Lease = { id: string; token: string };

function entryOf(overrides: Partial<RemoteOptions<Lease>> = {}) {
  const remote = defineRemote<Lease>(
    {
      name: "farm",
      engines: ["chromium"],
      sessions: 2,
      protocol: "playwright",
      reach: "loopback",
      retry: { attempts: 2, backoffMs: 1 },
      connect: { endpoint: "ws://127.0.0.1:1/" },
      ...overrides,
    },
    SUPPORT,
  );
  return remoteTargetsOf(remote)[0] as ReturnType<typeof remoteTargetsOf>[number];
}

const connection = (id: string): RemoteLeasedConnection<Lease> => ({
  endpoint: `ws://127.0.0.1:1/${id}/secret-path`,
  lease: { id, token: "lease-token" },
});

const connecting =
  (id = "a") =>
  async (): Promise<RemoteLeasedConnection<Lease>> =>
    await Promise.resolve(connection(id));

const noLeaseConnect = async (): Promise<RemoteLeasedConnection<Lease>> =>
  await Promise.resolve({ endpoint: "ws://127.0.0.1:3/" });

const halfWoken = async (): Promise<RemoteLeasedConnection<Lease>> =>
  await Promise.reject(new RemoteConnectError("half woken", { lease: { id: "h", token: "t" } }));

const open = <T>(value: T) => ({
  open: async () => await Promise.resolve(value),
  reasonOf,
});

afterEach(async () => {
  await shutdownRemote();
});

describe("connectLeased with a function connect", () => {
  it("tells connect which run it is for, opens the leased connection and releases once", async () => {
    const connect = vi.fn(
      async (_context: RemoteConnectContext) => await Promise.resolve(connection("a")),
    );
    const release = vi.fn();
    const opened = vi.fn(async (_connection: unknown) => await Promise.resolve("browser"));
    const { value, lease } = await connectLeased(entryOf({ connect, release }), CTX, {
      open: opened,
      reasonOf,
    });
    expect(value).toBe("browser");
    const context = connect.mock.calls[0]?.[0] as RemoteConnectContext;
    expect(context).toMatchObject({
      engine: "chromium",
      buildId: "b1",
      runId: "s2",
      shardIndex: 2,
      purpose: "render",
      attempt: 1,
    });
    expect(context.signal.aborted).toBe(false);
    expect(opened.mock.calls[0]?.[0]).toMatchObject({ endpoint: "ws://127.0.0.1:1/a/secret-path" });
    expect(release).not.toHaveBeenCalled();
    await lease.end("finished");
    await lease.end("failed");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(
      { id: "a", token: "lease-token" },
      { outcome: "finished", error: undefined },
    );
  });

  it("passes the error that failed the render to release", async () => {
    const release = vi.fn();
    const { lease } = await connectLeased(
      entryOf({ connect: connecting(), release }),
      CTX,
      open(1),
    );
    const cause = new Error("render failed");
    await lease.end("failed", cause);
    expect(release).toHaveBeenCalledWith(expect.anything(), { outcome: "failed", error: cause });
  });

  it("with a fixed connection connects to it and holds nothing", async () => {
    const { lease } = await connectLeased(entryOf(), CTX, open(1));
    await expect(lease.end("finished")).resolves.toBeUndefined();
  });

  it("gives concurrent shards distinct leases, each released once", async () => {
    let next = 0;
    const connect = vi.fn(async () => {
      next += 1;
      const id = String(next);
      return await Promise.resolve(connection(id));
    });
    const release = vi.fn();
    const entry = entryOf({ connect, release });
    const opened = await Promise.all(
      [1, 2, 3].map(
        async (shardIndex) =>
          await connectLeased(
            entry,
            { ...CTX, shardIndex },
            {
              open: async (c) => await Promise.resolve(c.endpoint),
              reasonOf,
            },
          ),
      ),
    );
    expect(new Set(opened.map((o) => o.value)).size).toBe(3);
    await Promise.all(opened.map(async (o) => await o.lease.end("finished")));
    expect(release).toHaveBeenCalledTimes(3);
  });

  it("releases a lease whose handshake failed as failed, then connects again with the next attempt number", async () => {
    let next = 0;
    const connect = vi.fn(async (_context: RemoteConnectContext) => {
      next += 1;
      return await Promise.resolve(connection(String(next)));
    });
    const release = vi.fn();
    const handshake = vi
      .fn<(c: unknown) => Promise<string>>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce("ok");
    const { lease } = await connectLeased(entryOf({ connect, release }), CTX, {
      open: handshake,
      reasonOf,
    });
    expect(connect.mock.calls.map((call) => call[0].attempt)).toEqual([1, 2]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[1]).toMatchObject({ outcome: "failed" });
    await lease.end("finished");
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("leaks no lease when the handshake never succeeds, and marks a permanent one unavailable", async () => {
    const release = vi.fn();
    const handshake = vi.fn(async () => await Promise.reject(new Error("401 Unauthorized")));
    const error = (await connectLeased(entryOf({ connect: connecting("x"), release }), CTX, {
      open: handshake,
      reasonOf,
    }).catch((caught: unknown) => caught)) as TargetLaunchError;
    expect(error).toBeInstanceOf(TargetLaunchError);
    expect(error.transient).toBe(false);
    expect(handshake).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("skips release when connect returns no lease, warning once per target", async () => {
    const warn = vi.fn();
    const release = vi.fn();
    for (let index = 0; index < 2; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- two sequential connects
      const { lease } = await connectLeased(
        entryOf({ name: "nolease", connect: noLeaseConnect, release }),
        CTX,
        {
          ...open(1),
          logger: { warn } as never,
        },
      );
      // oxlint-disable-next-line eslint/no-await-in-loop -- two sequential connects
      await lease.end("finished");
    }
    expect(release).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("connectLeased errors", () => {
  it("retries a throwing connect and ends as a transient launch error with a clear reason", async () => {
    const connect = vi.fn(async () => await Promise.reject(new Error("wake failed")));
    const handshake = vi.fn();
    const error = (await connectLeased(entryOf({ connect, release: vi.fn() }), CTX, {
      open: handshake,
      reasonOf,
    }).catch((caught: unknown) => caught)) as TargetLaunchError;
    expect(connect).toHaveBeenCalledTimes(3);
    expect(handshake).not.toHaveBeenCalled();
    expect(error.transient).toBe(true);
    expect(error.reason).toBe("acquire failed: wake failed");
  });

  it("does not retry an error that says transient: false, and marks the target unavailable", async () => {
    const connect = vi.fn(
      async () =>
        await Promise.reject(Object.assign(new Error("credentials expired"), { transient: false })),
    );
    const error = (await connectLeased(entryOf({ connect }), CTX, open(1)).catch(
      (caught: unknown) => caught,
    )) as TargetLaunchError;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(error.transient).toBe(false);
  });

  it("keeps the target offered for a permanent error scoped to the job", async () => {
    const connect = vi.fn(
      async () =>
        await Promise.reject(
          new RemoteConnectError("server gone", { transient: false, scope: "job" }),
        ),
    );
    const error = (await connectLeased(entryOf({ connect }), CTX, open(1)).catch(
      (caught: unknown) => caught,
    )) as TargetLaunchError;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(error.transient).toBe(true);
    expect(error.reason).toBe("server gone");
  });

  it("releases a lease the failed connect carried on its error", async () => {
    const release = vi.fn();
    await connectLeased(
      entryOf({ connect: halfWoken, release, retry: { attempts: 0 } }),
      CTX,
      open(1),
    ).catch(() => {});
    expect(release).toHaveBeenCalledWith(
      { id: "h", token: "t" },
      { outcome: "failed", error: expect.any(RemoteConnectError) },
    );
  });

  it("times connect out, aborting its signal, and releases a lease that arrives late", async () => {
    const release = vi.fn();
    let signal: AbortSignal | undefined;
    const connect = vi.fn(
      async (context: RemoteConnectContext) =>
        await new Promise<RemoteLeasedConnection<Lease>>((resolve) => {
          signal = context.signal;
          setTimeout(() => {
            resolve(connection("late"));
          }, 30);
        }),
    );
    const entry = entryOf({
      connect,
      release,
      timeouts: { acquireMs: 5 },
      retry: { attempts: 0 },
    });
    const error = (await connectLeased(entry, CTX, open(1)).catch(
      (caught: unknown) => caught,
    )) as TargetLaunchError;
    expect(error.reason).toContain("acquire timed out after 5 ms");
    expect(error.transient).toBe(true);
    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledWith(
        { id: "late", token: "lease-token" },
        { outcome: "failed", error: undefined },
      );
    });
  });

  it("stops without retrying when the run is cancelled while connect is pending", async () => {
    const controller = new AbortController();
    const connect = vi.fn(
      async ({ signal }: RemoteConnectContext) =>
        await new Promise<RemoteLeasedConnection<Lease>>((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const pending = connectLeased(
      entryOf({ connect }),
      { ...CTX, signal: controller.signal },
      open(1),
    );
    controller.abort();
    const error = (await pending.catch((caught: unknown) => caught)) as TargetLaunchError;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(error.reason).toBe("cancelled while connecting");
    expect(error.transient).toBe(true);
  });

  it.each([
    [
      "extra fields",
      { endpoint: "ws://h:1/", exposeNetwork: "<loopback>" },
      /protocol and reach are declared/u,
    ],
    ["a wrong scheme", { endpoint: "https://h:1/" }, /not a ws: or wss: URL/u],
  ])(
    "refuses a connection with %s, permanently for the job, releasing its lease",
    async (_label, extra, message) => {
      const release = vi.fn();
      const connect = async () => await Promise.resolve({ ...extra, lease: 7 } as never);
      const error = (await connectLeased(entryOf({ connect, release }), CTX, open(1)).catch(
        (caught: unknown) => caught,
      )) as TargetLaunchError;
      expect(error.transient).toBe(true);
      expect(error.reason).toMatch(message);
      expect(release).toHaveBeenCalledWith(7, { outcome: "failed", error: undefined });
    },
  );
});

describe("cancellation", () => {
  it("never calls connect with a signal that is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const connect = vi.fn(connecting());
    const error = (await connectLeased(
      entryOf({ connect }),
      { ...CTX, signal: controller.signal },
      open(1),
    ).catch((caught: unknown) => caught)) as TargetLaunchError;
    expect(connect).not.toHaveBeenCalled();
    expect(error.reason).toBe("cancelled while connecting");
  });

  it("stops listening to the run's signal once an attempt is over", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await connectLeased(
      entryOf({ connect: connecting() }),
      { ...CTX, signal: controller.signal },
      open(1),
    );
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("release", () => {
  it("logs a failing release without the lease or the message, and does not throw", async () => {
    const warn = vi.fn();
    const release = vi.fn(() => {
      throw new Error("sleep failed token=lease-token");
    });
    const { lease } = await connectLeased(entryOf({ connect: connecting(), release }), CTX, {
      ...open(1),
      logger: { warn } as never,
    });
    await expect(lease.end("finished")).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("lease-token");
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ outcome: "finished", err: "Error" });
  });

  it("gives up on a release that hangs, after releaseMs", async () => {
    const warn = vi.fn();
    const release = vi.fn(async () => await new Promise<void>(() => {}));
    const { lease } = await connectLeased(
      entryOf({ connect: connecting(), release, timeouts: { releaseMs: 5 } }),
      CTX,
      { ...open(1), logger: { warn } as never },
    );
    await lease.end("finished");
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ err: "ReleaseTimeout" });
  });
});

describe("shutdownRemote", () => {
  it("aborts a pending connect, releases every held lease as cancelled, then runs the hooks", async () => {
    const release = vi.fn();
    const order: string[] = [];
    const hook = onRemoteShutdown(async () => {
      order.push(`hook after ${release.mock.calls.length} release`);
      await Promise.resolve();
    });
    await connectLeased(entryOf({ connect: connecting("s"), release }), CTX, open(1));
    const pendingConnect = vi.fn(
      async ({ signal }: RemoteConnectContext) =>
        await new Promise<RemoteLeasedConnection<Lease>>((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const pending = connectLeased(entryOf({ connect: pendingConnect }), CTX, open(1)).catch(
      (caught: unknown) => caught,
    );
    await shutdownRemote();
    expect(await pending).toBeInstanceOf(TargetLaunchError);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[1]).toMatchObject({ outcome: "cancelled" });
    expect(order).toEqual(["hook after 1 release"]);
    await shutdownRemote();
    expect(release).toHaveBeenCalledTimes(1);
    hook();
  });
});
