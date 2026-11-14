import { describe, expect, it } from "vitest";
import { loadWorker, type Worker } from "./service-worker-harness.ts";

async function kept(): Promise<Worker> {
  const worker = loadWorker();
  worker.server.builds.set("a", {
    slug: "a",
    buildId: "b1",
    commit: "1234567890abc",
    files: { "index.html": "<h1>root</h1>", "assets/app.js": "js", "dir/index.html": "dir" },
  });
  await worker.send({ type: "keep", slug: "a" });
  worker.server.online = false;
  worker.server.requests = [];
  return worker;
}

describe("serving /offline", () => {
  it("serves files only from the cache, with content type and no sandbox header", async () => {
    const worker = await kept();
    const res = await worker.fetch("/offline/a/assets/app.js", { mode: "navigate" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("js");
    expect(res.headers.get("content-type")).toBe("application/javascript");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.has("content-security-policy")).toBe(false);
    expect(worker.server.requests).toEqual([]);
  });

  it("serves index.html for the root and for directories", async () => {
    const worker = await kept();
    expect(await (await worker.fetch("/offline/a/")).text()).toBe("<h1>root</h1>");
    expect(await (await worker.fetch("/offline/a/dir/")).text()).toBe("dir");
  });

  it("redirects a slug without a trailing slash", async () => {
    const res = await (await kept()).fetch("/offline/a");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://shelf.test/offline/a/");
  });

  it("answers 404 for unknown projects, files and unsafe paths, never the network", async () => {
    const worker = await kept();
    worker.server.online = true;
    const paths = [
      "/offline/zzz/",
      "/offline/a/missing.js",
      "/offline/a/..%5Csecret",
      "/offline/a/assets//app.js",
      "/offline/a/%E0%A4%A",
      "/offline/%E0%A4%A/x",
      "/offline/__proto__/x",
    ];
    const statuses = await Promise.all(
      paths.map(async (path) => (await worker.fetch(path)).status),
    );
    expect(statuses).toEqual(paths.map(() => 404));
    expect(worker.server.requests).toEqual([]);
  });

  it("answers 404 when the cached bytes are gone", async () => {
    const worker = await kept();
    worker.caches.get("storyshelf-offline-content-v1")?.clear();
    expect((await worker.fetch("/offline/a/")).status).toBe(404);
  });
});

describe("expiry", () => {
  it("stops serving a project maxOfflineDays after its last successful sync", async () => {
    const worker = await kept();
    const state = worker.idb.get("state") as { projects: Record<string, { syncedAt: string }> };
    const DAY = 86_400_000;
    state.projects["a"]!.syncedAt = new Date(Date.now() - 29 * DAY).toISOString();
    expect((await worker.fetch("/offline/a/")).status).toBe(200);
    state.projects["a"]!.syncedAt = new Date(Date.now() - 31 * DAY).toISOString();
    expect((await worker.fetch("/offline/a/")).status).toBe(404);
    const home = await (await worker.fetch("/offline")).text();
    expect(home).toContain("expired");
    expect(home).not.toContain('href="/offline/a/"');
    expect((await worker.send({ type: "usage" }))?.usage.projects[0]?.expired).toBe(true);
  });

  it("takes the limit from the last sync answer, and a sync renews it", async () => {
    const worker = await kept();
    const state = worker.idb.get("state") as {
      projects: Record<string, { syncedAt: string; maxOfflineDays: number }>;
    };
    state.projects["a"]!.syncedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    state.projects["a"]!.maxOfflineDays = 2;
    expect((await worker.fetch("/offline/a/")).status).toBe(404);
    worker.server.online = true;
    await worker.send({ type: "sync" });
    expect((await worker.fetch("/offline/a/")).status).toBe(200);
  });
});

describe("offline home page", () => {
  it("lists one link per kept project with its commit and sync time", async () => {
    const worker = await kept();
    const res = await worker.fetch("/offline");
    const html = await res.text();
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(html).toContain('href="/offline/a/"');
    expect(html).toContain("Name a");
    expect(html).toContain("1234567");
    expect(html).toContain("synced 20");
  });

  it("escapes project names", async () => {
    const worker = await kept();
    const state = worker.idb.get("state") as { projects: Record<string, { name: string }> };
    state.projects["a"]!.name = "<img src=x onerror=1>";
    expect(await (await worker.fetch("/offline/")).text()).not.toContain("<img");
  });

  it("says so when nothing is kept", async () => {
    expect(await (await loadWorker().fetch("/offline")).text()).toContain("None.");
  });
});
