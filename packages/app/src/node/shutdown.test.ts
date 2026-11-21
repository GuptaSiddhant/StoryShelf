import { Agent, request as httpRequest, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShelfLifecycle } from "../app-types.ts";
import { realApp, type RealApp } from "./__fixtures__/real-app.ts";
import { closeReserveMs } from "./shutdown.ts";
import { startServer } from "./start-server.ts";
import type { NodeHostApp } from "./types.ts";

const apps: RealApp[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.cleanup();
  }
});

/**
 * The real app behind a gate: `GET /__slow` waits for `release()` before the app answers it (a
 * request in flight), and `GET /__hang` never answers. Every other request goes straight through.
 */
function gatedApp(events: string[] = []): {
  host: NodeHostApp;
  release(): void;
  started: Promise<void>;
  real: RealApp;
} {
  const real = realApp();
  apps.push(real);
  const gate = Promise.withResolvers<null>();
  const arrived = Promise.withResolvers<null>();
  const host: NodeHostApp = {
    lifecycle: real.app.lifecycle,
    fetch: async (request, env) => {
      const path = new URL(request.url).pathname;
      if (path === "/__hang") {
        arrived.resolve(null);
        return await new Promise<Response>(() => {});
      }
      if (path === "/__slow") {
        arrived.resolve(null);
        await gate.promise;
        const answer = await real.app.request("/api/v1/health");
        events.push("answered");
        return answer;
      }
      return await real.app.fetch(request, env);
    },
  };
  return {
    host,
    release: () => {
      gate.resolve(null);
    },
    started: arrived.promise.then(() => {}),
    real,
  };
}

interface Answer {
  status: number;
  connection: string | undefined;
  body: string;
}

/** GET over a keep-alive agent; resolves with the answer, rejects when the socket is destroyed. */
async function get(url: string, agent: Agent): Promise<Answer> {
  return await new Promise<Answer>((resolve, reject) => {
    httpRequest(url, { agent }, (response: IncomingMessage) => {
      let body = "";
      response.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          connection: response.headers.connection,
          body,
        });
      });
      response.on("error", reject);
    })
      .on("error", reject)
      .end();
  });
}

describe("shutdown with requests in flight", () => {
  it("finishes an in-flight request with Connection: close and closes idle keep-alive sockets at once", async () => {
    const { host, release, started, real } = gatedApp();
    const server = await startServer({ app: host, port: 0, hostname: "127.0.0.1" });
    const idleAgent = new Agent({ keepAlive: true });
    const busyAgent = new Agent({ keepAlive: true });
    const warm = await get(`${server.url}/api/v1/health`, idleAgent);
    expect(warm.connection).toBe("keep-alive");
    const slow = get(`${server.url}/__slow`, busyAgent);
    await started;
    const closing = server.close();
    // The listener stops accepting while the request is still in flight.
    await expect(get(`${server.url}/api/v1/health`, new Agent())).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
    release();
    const answer = await slow;
    expect(answer).toMatchObject({ status: 200, connection: "close" });
    const result = await closing;
    // Far below the 5 s keep-alive timeout an idle socket would otherwise hold the close for.
    expect(result.durationMs).toBeLessThan(2000);
    expect(result).toMatchObject({ complete: true, trigger: "close" });
    expect(real.teardowns()).toBe(1);
    idleAgent.destroy();
    busyAgent.destroy();
  });

  it("the app outlives its requests: teardown starts only once the request has finished", async () => {
    const order: string[] = [];
    const { host, release, started } = gatedApp(order);
    const lifecycle = host.lifecycle;
    const teardown = vi.spyOn(lifecycle, "teardown").mockImplementation(async (options) => {
      order.push("teardown");
      teardown.mockRestore();
      await lifecycle.teardown(options);
    });
    const server = await startServer({ app: host, port: 0, hostname: "127.0.0.1" });
    const slow = get(`${server.url}/__slow`, new Agent());
    await started;
    const closing = server.close();
    release();
    await Promise.all([slow, closing]);
    expect(order).toEqual(["answered", "teardown"]);
  });
});

describe("shutdown timeout", () => {
  it("fences a request that never ends: its socket is destroyed and the result is incomplete", async () => {
    const { host, started, real } = gatedApp();
    const server = await startServer({
      app: host,
      port: 0,
      hostname: "127.0.0.1",
      shutdownTimeoutMs: 400,
    });
    const hanging = get(`${server.url}/__hang`, new Agent());
    await started;
    const result = await server.close();
    await expect(hanging).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(result).toMatchObject({ complete: false, incomplete: "timeout" });
    expect(result.durationMs).toBeGreaterThanOrEqual(190);
    expect(result.durationMs).toBeLessThan(1500);
    // The app was still torn down, within what was left of the budget.
    expect(real.teardowns()).toBe(1);
  });

  it("resolves by the deadline when the app's teardown hangs, and says so", async () => {
    const real = realApp();
    apps.push(real);
    const stuck = vi.fn(async () => await new Promise<void>(() => {}));
    const lifecycle: ShelfLifecycle = { ...real.app.lifecycle, teardown: stuck };
    Object.defineProperty(lifecycle, "ready", { get: () => real.app.lifecycle.ready });
    const app: NodeHostApp = { lifecycle, fetch: real.app.fetch.bind(real.app) };
    const server = await startServer({ app, port: 0, shutdownTimeoutMs: 300 });
    const startedAt = Date.now();
    const result = await server.close();
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(result).toMatchObject({ complete: false, incomplete: "timeout" });
    expect(stuck).toHaveBeenCalledOnce();
    await real.app.lifecycle.teardown();
  });

  it("reports a failed teardown as incomplete", async () => {
    const real = realApp();
    apps.push(real);
    const lifecycle: ShelfLifecycle = {
      ...real.app.lifecycle,
      teardown: async () => {
        await real.app.lifecycle.teardown();
        throw new Error("adapter close failed");
      },
    };
    const app: NodeHostApp = { lifecycle, fetch: real.app.fetch.bind(real.app) };
    const server = await startServer({ app, port: 0 });
    await expect(server.close()).resolves.toMatchObject({
      complete: false,
      incomplete: "teardown-failed",
    });
  });
});

describe("background job teardown", () => {
  it("hands the app's job drain what is left of the budget as its #912 graceMs, once", async () => {
    const real = realApp();
    apps.push(real);
    const teardown = vi.spyOn(real.app.lifecycle, "teardown");
    const server = await startServer({ app: real.app, port: 0, shutdownTimeoutMs: 8000 });
    await server.close();
    expect(teardown).toHaveBeenCalledOnce();
    const graceMs = teardown.mock.calls[0]?.[0]?.graceMs ?? -1;
    // Nothing was in flight, so almost the whole budget is left, less the adapter-close reserve.
    expect(graceMs).toBeLessThanOrEqual(8000 - closeReserveMs(8000));
    expect(graceMs).toBeGreaterThan(8000 - closeReserveMs(8000) - 500);
    expect(real.teardowns()).toBe(1);
  });

  it("keeps a reserve for closing adapters: a second, or a quarter of a short budget", () => {
    expect(closeReserveMs(30_000)).toBe(1000);
    expect(closeReserveMs(2000)).toBe(500);
    expect(closeReserveMs(0)).toBe(0);
  });
});
