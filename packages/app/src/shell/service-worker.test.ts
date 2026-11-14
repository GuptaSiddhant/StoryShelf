import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { serviceWorkerScript } from "./service-worker.ts";

type FetchEvent = { request: { mode: string }; respondWith: (r: Promise<Response>) => void };

/** Load the worker in a sandbox; returns its `fetch` listener and the requests it sent on. */
function loadWorker(network: (req: { mode: string }) => Promise<Response>): {
  fire: (mode: string) => Promise<Response>;
} {
  const listeners = new Map<string, (event: never) => void>();
  runInNewContext(serviceWorkerScript(), {
    self: {
      addEventListener: (name: string, fn: (event: never) => void) => listeners.set(name, fn),
      skipWaiting: () => null,
      clients: { claim: async () => await Promise.resolve() },
    },
    fetch: network,
    Response,
  });
  return {
    fire: async (mode) => {
      const answers: Promise<Response>[] = [];
      const event: FetchEvent = {
        request: { mode },
        respondWith: (r) => answers.push(r),
      };
      listeners.get("fetch")?.(event as never);
      const [answer] = answers;
      if (!answer) {
        throw new Error("worker did not respond");
      }
      return await answer;
    },
  };
}

describe("service worker fetch handler", () => {
  it("passes requests through to the network untouched", async () => {
    const worker = loadWorker(
      async () => await Promise.resolve(new Response("live", { status: 201 })),
    );
    const modes = ["navigate", "cors", "same-origin"];
    const responses = await Promise.all(modes.map(async (mode) => await worker.fire(mode)));
    expect(responses.map((res) => res.status)).toEqual([201, 201, 201]);
    expect(await Promise.all(responses.map(async (res) => await res.text()))).toEqual([
      "live",
      "live",
      "live",
    ]);
  });

  it("answers a failed navigation with the offline placeholder", async () => {
    const worker = loadWorker(async () => await Promise.reject(new TypeError("offline")));
    const res = await worker.fire("navigate");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("You are offline");
  });

  it("lets a failed non-navigation request fail", async () => {
    const worker = loadWorker(async () => await Promise.reject(new TypeError("offline")));
    await expect(worker.fire("cors")).rejects.toThrow("offline");
  });

  it("never touches Cache Storage", () => {
    expect(serviceWorkerScript()).not.toMatch(/caches|indexedDB/u);
  });
});
