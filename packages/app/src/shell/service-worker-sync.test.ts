import { describe, expect, it } from "vitest";
import { loadWorker, sha, type FakeBuild } from "./service-worker-harness.ts";

const build = (over: Partial<FakeBuild> = {}): FakeBuild => ({
  slug: "a",
  buildId: "b1",
  files: { "index.html": "<h1>one</h1>", "app.js": "console.log(1)" },
  ...over,
});

describe("keep and sync diff", () => {
  it("keeps a project and downloads every hash once", async () => {
    const worker = loadWorker();
    worker.server.builds.set(
      "a",
      build({ files: { "x.js": "same", "y.js": "same", "z.js": "z" } }),
    );
    const reply = await worker.send({ type: "keep", slug: "a" });
    expect(reply?.ok).toBe(true);
    expect(worker.server.downloads).toHaveLength(2);
    expect(reply?.usage.projects.map((p) => p.slug)).toEqual(["a"]);
    expect(reply?.usage.persisted).toBe(true);
    expect(reply?.usage.usedBytes).toBe("same".length + "z".length);
  });

  it("downloads only the hashes a second build changed", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "keep", slug: "a" });
    worker.server.downloads = [];
    worker.server.builds.set(
      "a",
      build({ buildId: "b2", files: { "index.html": "<h1>one</h1>", "app.js": "console.log(2)" } }),
    );
    await worker.send({ type: "sync" });
    expect(worker.server.downloads).toEqual(["/projects/a/storybook/build/b2/app.js"]);
  });

  it("deletes hashes no kept project refers to", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "keep", slug: "a" });
    worker.server.builds.set("a", build({ buildId: "b2", files: { "index.html": "new" } }));
    await worker.send({ type: "sync" });
    const cache = worker.caches.get("storyshelf-offline-content-v1");
    expect([...(cache?.keys() ?? [])]).toEqual([
      `https://shelf.test/__offline/content/${sha("new")}`,
    ]);
  });

  it("drops a project the answer leaves out, and its files", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "keep", slug: "a" });
    worker.server.builds.delete("a");
    const reply = await worker.send({ type: "sync" });
    expect(reply?.usage.projects).toEqual([]);
    expect(worker.caches.get("storyshelf-offline-content-v1")?.size ?? 0).toBe(0);
  });

  it("answers unavailable for a project the server does not offer", async () => {
    const reply = await loadWorker().send({ type: "keep", slug: "nope" });
    expect(reply).toMatchObject({ ok: false, error: "unavailable" });
  });

  it("keeps the old copy and reports a failed download or a hash mismatch", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "keep", slug: "a" });
    worker.server.builds.set("a", build({ buildId: "b2", files: { "index.html": "next" } }));
    worker.server.corrupt = true;
    await worker.send({ type: "sync" });
    const usage = await worker.send({ type: "usage" });
    expect(usage?.usage.projects[0]).toMatchObject({ commit: "abcdef1234567" });
    expect(await (await worker.fetch("/offline/a/")).text()).toContain("one");
  });

  it("changes nothing when the network is down", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "keep", slug: "a" });
    worker.server.online = false;
    expect(await worker.send({ type: "sync" })).toMatchObject({ ok: false, error: "offline" });
    expect((await worker.send({ type: "usage" }))?.usage.projects).toHaveLength(1);
  });

  it("clears everything when the server says the user is signed out", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "keep", slug: "a" });
    worker.server.status = 401;
    expect(await worker.send({ type: "sync" })).toMatchObject({ ok: false, error: "signed-out" });
    expect(worker.caches.has("storyshelf-offline-content-v1")).toBe(false);
    expect((await worker.send({ type: "usage" }))?.usage.projects).toEqual([]);
  });

  it("makes no request at all when nothing is kept", async () => {
    const worker = loadWorker();
    await worker.send({ type: "sync" });
    expect(worker.server.requests).toEqual([]);
  });

  it("unkeeps a project and collects its files", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "keep", slug: "a" });
    await worker.send({ type: "unkeep", slug: "a" });
    expect(worker.caches.get("storyshelf-offline-content-v1")?.size).toBe(0);
  });
});

describe("signed out and hosting mode", () => {
  it("clears every copy when the answer is an empty list, and keeps the cap setting", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "set-cap", bytes: 1_000_000 });
    await worker.send({ type: "keep", slug: "a" });
    worker.server.builds.delete("a");
    const reply = await worker.send({ type: "sync" });
    expect(worker.caches.has("storyshelf-offline-content-v1")).toBe(false);
    expect(reply?.usage).toMatchObject({ projects: [], usedBytes: 0, capBytes: 1_000_000 });
  });

  it("clears the cap setting too when the server says the user is signed out", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "set-cap", bytes: 1_000_000 });
    await worker.send({ type: "keep", slug: "a" });
    worker.server.status = 403;
    await worker.send({ type: "sync" });
    expect(worker.caches.has("storyshelf-offline-content-v1")).toBe(false);
    expect((await worker.send({ type: "usage" }))?.usage.capBytes).toBe(500 * 1024 * 1024);
  });

  it("refuses to keep outside trusted hosting mode and downloads nothing", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    worker.server.hostingOff = true;
    expect(await worker.send({ type: "keep", slug: "a" })).toMatchObject({
      ok: false,
      error: "hosting-mode",
    });
    expect(worker.server.downloads).toEqual([]);
    expect(worker.caches.get("storyshelf-offline-content-v1")?.size ?? 0).toBe(0);
  });

  it("removes copies already kept on the next sync once the mode is not trusted", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "keep", slug: "a" });
    worker.server.hostingOff = true;
    await worker.send({ type: "sync" });
    expect(worker.caches.has("storyshelf-offline-content-v1")).toBe(false);
    expect((await worker.fetch("/offline/a/")).status).toBe(404);
  });
});

describe("cap", () => {
  it("refuses a project that would pass the cap, says its size, and stores nothing", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "set-cap", bytes: 10 });
    const reply = await worker.send({ type: "keep", slug: "a" });
    expect(reply).toMatchObject({ ok: false, error: "cap", size: 12 + 14 });
    expect(worker.server.downloads).toEqual([]);
    expect(reply?.usage.projects).toEqual([]);
  });

  it("counts hashes shared with another kept project once", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build({ files: { "a.js": "x".repeat(40) } }));
    worker.server.builds.set("b", build({ slug: "b", files: { "b.js": "x".repeat(40) } }));
    await worker.send({ type: "set-cap", bytes: 50 });
    expect((await worker.send({ type: "keep", slug: "a" }))?.ok).toBe(true);
    expect((await worker.send({ type: "keep", slug: "b" }))?.ok).toBe(true);
    expect((await worker.send({ type: "usage" }))?.usage.usedBytes).toBe(40);
  });

  it("never evicts a kept project when a newer build passes the cap", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    await worker.send({ type: "set-cap", bytes: 30 });
    await worker.send({ type: "keep", slug: "a" });
    worker.server.builds.set("a", build({ buildId: "b2", files: { "big.js": "y".repeat(100) } }));
    const state = worker.idb.get("state") as {
      projects: Record<string, { syncedAt: string }>;
    };
    state.projects["a"]!.syncedAt = new Date(Date.now() - 86_400_000).toISOString();
    worker.server.builds.get("a")!.maxOfflineDays = 7;
    const before = structuredClone(worker.idb.get("state"));
    await worker.send({ type: "sync" });
    expect(await (await worker.fetch("/offline/a/")).text()).toContain("one");
    expect(worker.idb.get("state")).toEqual(before);
  });

  it("waits for every download lane and stops scheduling after a failure", async () => {
    const worker = loadWorker();
    const files = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`f${i}.js`, `file ${i}`]),
    );
    worker.server.builds.set("a", build({ files }));
    worker.server.corrupt = true;
    expect(await worker.send({ type: "keep", slug: "a" })).toMatchObject({ error: "download" });
    expect(worker.server.downloads.length).toBeLessThanOrEqual(6);
    const settled = worker.server.downloads.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(worker.server.downloads).toHaveLength(settled);
    expect(worker.caches.get("storyshelf-offline-content-v1")?.size ?? 0).toBe(0);
  });

  it("rejects an invalid cap and unknown messages", async () => {
    const worker = loadWorker();
    expect(await worker.send({ type: "set-cap", bytes: -1 })).toMatchObject({ error: "invalid" });
    expect(await worker.send({ type: "keep" })).toMatchObject({ error: "invalid" });
    expect(await worker.send({ type: "bogus" })).toMatchObject({ error: "unknown" });
  });
});

describe("message origin", () => {
  it("ignores messages from a Storybook's own frames", async () => {
    const worker = loadWorker();
    worker.server.builds.set("a", build());
    for (const from of [
      "https://shelf.test/offline/a/iframe.html",
      "https://shelf.test/projects/a/storybook/build/b1/",
      "https://shelf.test/_s/x/",
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one frame at a time
      expect(await worker.send({ type: "keep", slug: "a" }, from)).toBeUndefined();
    }
    expect(worker.server.requests).toEqual([]);
  });
});
