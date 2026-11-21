import { AdapterLifecycleError } from "@storyshelf/core/adapter/setup";
import { createServer as createNetServer, connect } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { realApp, type RealApp } from "./__fixtures__/real-app.ts";
import { StartInterruptedError } from "./errors.ts";
import { startServer } from "./start-server.ts";

const apps: RealApp[] = [];
/** Another module's SIGTERM handler, which the host must leave in place. */
const theirs = (): void => {};
function track(app: RealApp): RealApp {
  apps.push(app);
  return app;
}

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.cleanup();
  }
});

/** A port nothing listens on. */
async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve();
    });
  });
  return typeof address === "object" && address ? address.port : 0;
}

/** Whether something accepts TCP connections on `port`. */
async function accepts(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

describe("startServer readiness", () => {
  it("waits for the app's setup, runs beforeListen, then serves the real app", async () => {
    const { app, teardowns } = track(realApp());
    const port = await freePort();
    const order: string[] = [];
    const server = await startServer({
      app,
      port,
      hostname: "127.0.0.1",
      beforeListen: async () => {
        const ready = (await app.lifecycle.ready).ok;
        order.push(`ready=${String(ready)}`, `listening=${String(await accepts(port))}`);
      },
    });
    expect(order).toEqual(["ready=true", "listening=false"]);
    const health = await fetch(`${server.url}/api/v1/health`);
    expect(health.status).toBe(200);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    const result = await server.close();
    expect(result).toMatchObject({ complete: true, trigger: "close" });
    expect(teardowns()).toBe(1);
  });

  it("rejects a failed boot without listening, after tearing the app down once", async () => {
    const { app, teardowns } = track(realApp({ failSetup: "storage unreachable" }));
    const port = await freePort();
    await expect(startServer({ app, port, hostname: "127.0.0.1" })).rejects.toBeInstanceOf(
      AdapterLifecycleError,
    );
    expect(await accepts(port)).toBe(false);
    expect(teardowns()).toBe(1);
  });

  it("keeps a failed beforeListen as the primary error, its secret redacted", async () => {
    const { app, teardowns } = track(realApp());
    const failure = startServer({
      app,
      port: 0,
      beforeListen: () => {
        throw new Error("seed failed: password=hunter2-hunter2");
      },
    });
    await expect(failure).rejects.toThrow("seed failed: password=[redacted]");
    await expect(failure).rejects.not.toThrow("hunter2");
    expect(teardowns()).toBe(1);
  });

  it("rejects an occupied port with EADDRINUSE and tears the app down once", async () => {
    const occupant = createNetServer();
    await new Promise<void>((resolve) => {
      occupant.listen(0, "127.0.0.1", resolve);
    });
    const address = occupant.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const { app, teardowns } = track(realApp());
    try {
      await expect(startServer({ app, port, hostname: "127.0.0.1" })).rejects.toMatchObject({
        code: "EADDRINUSE",
      });
      expect(teardowns()).toBe(1);
    } finally {
      occupant.close();
    }
  });

  it("refuses a shutdown timeout that is not a whole number of ms, before touching the app", async () => {
    const { app, teardowns } = track(realApp());
    for (const shutdownTimeoutMs of [-1, 1.5, Number.NaN, Infinity]) {
      // oxlint-disable-next-line no-await-in-loop -- each value is refused on its own
      await expect(startServer({ app, port: 0, shutdownTimeoutMs })).rejects.toThrow(RangeError);
    }
    expect(teardowns()).toBe(0);
    await app.lifecycle.teardown();
  });
});

describe("startServer interrupted start-up", () => {
  it("an abort during start-up stops it before the port opens and tears down once", async () => {
    const { app, teardowns } = track(realApp());
    const port = await freePort();
    const controller = new AbortController();
    const started = startServer({
      app,
      port,
      hostname: "127.0.0.1",
      signal: controller.signal,
      beforeListen: () => {
        controller.abort();
      },
    });
    await expect(started).rejects.toBeInstanceOf(StartInterruptedError);
    await expect(started).rejects.toMatchObject({ trigger: "abort" });
    expect(await accepts(port)).toBe(false);
    expect(teardowns()).toBe(1);
  });

  it("an abort while the app is still setting up wins over the abandoned setup", async () => {
    const { app, teardowns } = track(realApp());
    const controller = new AbortController();
    const started = startServer({ app, port: 0, signal: controller.signal });
    controller.abort();
    await expect(started).rejects.toBeInstanceOf(StartInterruptedError);
    expect(teardowns()).toBe(1);
  });

  it("an already-aborted signal never opens the port", async () => {
    const { app, teardowns } = track(realApp());
    const port = await freePort();
    const started = startServer({ app, port, signal: AbortSignal.abort() });
    await expect(started).rejects.toBeInstanceOf(StartInterruptedError);
    expect(await accepts(port)).toBe(false);
    expect(teardowns()).toBe(1);
  });
});

describe("startServer close", () => {
  it("is idempotent: repeated, concurrent and late calls share one shutdown", async () => {
    const { app, teardowns } = track(realApp());
    const teardown = vi.spyOn(app.lifecycle, "teardown");
    const server = await startServer({ app, port: 0 });
    const [first, second] = await Promise.all([server.close(), server.close()]);
    const third = await server.close();
    expect(second).toBe(first);
    expect(third).toBe(first);
    await expect(server.closed).resolves.toBe(first);
    expect(teardown).toHaveBeenCalledOnce();
    expect(teardowns()).toBe(1);
  });

  it("an abort after start-up shuts down once, and close() then returns that shutdown", async () => {
    const { app, teardowns } = track(realApp());
    const controller = new AbortController();
    const server = await startServer({ app, port: 0, signal: controller.signal });
    controller.abort();
    const result = await server.closed;
    expect(result).toMatchObject({ complete: true, trigger: "abort" });
    await expect(server.close()).resolves.toBe(result);
    expect(teardowns()).toBe(1);
  });

  it("registers no signal handler unless asked, and removes only its own", async () => {
    const { app } = track(realApp());
    const before = {
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
    };
    const quiet = await startServer({ app, port: 0 });
    expect(process.listenerCount("SIGINT")).toBe(before.SIGINT);
    expect(process.listenerCount("SIGTERM")).toBe(before.SIGTERM);
    await quiet.close();

    const other = track(realApp());
    process.on("SIGTERM", theirs);
    try {
      const handling = await startServer({ app: other.app, port: 0, handleSignals: true });
      expect(process.listenerCount("SIGINT")).toBe(before.SIGINT + 1);
      expect(process.listenerCount("SIGTERM")).toBe(before.SIGTERM + 2);
      await handling.close();
      expect(process.listenerCount("SIGINT")).toBe(before.SIGINT);
      expect(process.listeners("SIGTERM")).toContain(theirs);
      expect(process.listenerCount("SIGTERM")).toBe(before.SIGTERM + 1);
    } finally {
      process.off("SIGTERM", theirs);
    }
  });
});
