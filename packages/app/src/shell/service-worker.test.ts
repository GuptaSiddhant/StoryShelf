import { describe, expect, it } from "vitest";
import { loadWorker } from "./service-worker-harness.ts";
import { serviceWorkerScript } from "./service-worker.ts";

describe("service worker fetch handler", () => {
  it("passes requests through to the network untouched", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", { slug: "a", buildId: "b1", files: { "x.js": "x" } });
    const res = await worker.fetch("/projects/a/storybook/build/b1/x.js", { mode: "navigate" });
    expect(await res.text()).toBe("x");
    expect(await (await worker.fetch("/api/v1/offline?projects=zz")).json()).toEqual({
      projects: [],
    });
  });

  it("answers a failed navigation with the offline home page, never an app page", async () => {
    const worker = loadWorker();
    worker.server.online = false;
    const res = await worker.fetch("/projects", { mode: "navigate" });
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("You are offline");
  });

  it("lets a failed non-navigation request fail", async () => {
    const worker = loadWorker();
    worker.server.online = false;
    await expect(worker.fetch("/api/v1/me")).rejects.toThrow("offline");
  });

  it("never stores app HTML or API answers, and keeps no state of its own for them", async () => {
    const worker = loadWorker();
    await worker.fetch("/", { mode: "navigate" });
    await worker.fetch("/api/v1/offline?projects=a");
    expect(worker.caches.size).toBe(0);
    expect(worker.idb.size).toBe(0);
  });

  it("refuses to cache anything but offline content keys", () => {
    expect(serviceWorkerScript().match(/cache\.put\(/gu)).toHaveLength(1);
  });

  it("rejects non-GET requests under /offline", async () => {
    const res = await loadWorker().fetch("/offline/a/", { method: "POST" });
    expect(res.status).toBe(405);
  });
});
