import { Agent, request } from "node:http";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { openListener } from "./listener.ts";
import type { NodeHostApp } from "./types.ts";

const logger = pino({ level: "silent" });
const app = {
  fetch: () => new Response("ok"),
  lifecycle: {} as NodeHostApp["lifecycle"],
} satisfies NodeHostApp;

describe("openListener", () => {
  it("listens, answers through the app's fetch, and drains to closed", async () => {
    const listener = openListener(app, { port: 0, hostname: "127.0.0.1" }, logger);
    const { port } = await listener.listening;
    const body = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    expect(body).toBe("ok");
    await expect(listener.drain(Date.now() + 1000)).resolves.toBe(true);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });

  it("drains a listener that failed to open as nothing left to do", async () => {
    const first = openListener(app, { port: 0, hostname: "127.0.0.1" }, logger);
    const { port } = await first.listening;
    const second = openListener(app, { port, hostname: "127.0.0.1" }, logger);
    await expect(second.listening).rejects.toMatchObject({ code: "EADDRINUSE" });
    await expect(second.drain(Date.now() + 1000)).resolves.toBe(true);
    await first.drain(Date.now() + 1000);
  });

  it("answers a request still in flight when the drain starts with Connection: close", async () => {
    const gate = Promise.withResolvers<null>();
    const arrived = Promise.withResolvers<null>();
    const slow: NodeHostApp = {
      ...app,
      fetch: async () => {
        arrived.resolve(null);
        await gate.promise;
        return new Response("late");
      },
    };
    const listener = openListener(slow, { port: 0, hostname: "127.0.0.1" }, logger);
    const { port } = await listener.listening;
    const agent = new Agent({ keepAlive: true });
    const answered = new Promise<string | undefined>((resolve, reject) => {
      request(`http://127.0.0.1:${port}/`, { agent }, (response) => {
        response.resume();
        resolve(response.headers.connection);
      })
        .on("error", reject)
        .end();
    });
    await arrived.promise;
    const draining = listener.drain(Date.now() + 1000);
    gate.resolve(null);
    await expect(answered).resolves.toBe("close");
    await expect(draining).resolves.toBe(true);
    agent.destroy();
  });
});
