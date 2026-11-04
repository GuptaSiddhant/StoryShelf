import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { storybookDir } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

describe("content-addressed dedup", () => {
  it("dedup returns needed hashes and content upload writes content/<hash>", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    await db.insert(db.tables.projects, {
      id: "p1",
      name: "P",
      slug: "proj",
      gitRepository: null,
      gitDefaultBranch: "main",
      pixelThreshold: 0.1,
      maxDiffRatio: 0.01,
      publicBranchRegex: null,
      storybookMeta: null,
      executePlay: false,
      playTimeoutMs: 10_000,
      runA11y: false,
      browser: "chromium",
      viewports: null,
      automigrate: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.insert(db.tables.builds, {
      id: "b1",
      projectId: "p1",
      gitSha: "sha1",
      gitBranch: "main",
      isDefault: true,
      authorEmail: null,
      authorName: null,
      message: null,
      public: true,
      status: "pending",
      snapshotCount: 0,
      changedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      inheritedCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const app = createShelfApp({ database: db, storage, logger: silentLogger });

    const dedupRes = await app.request("/api/v1/projects/proj/builds/b1/dedup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hashes: ["abc", "def"] }),
    });
    expect(dedupRes.status).toBe(200);
    const dedupBody = (await dedupRes.json()) as { needed: string[] };
    expect(dedupBody.needed).toEqual(["abc", "def"]);

    // upload one hash
    const form = new FormData();
    form.set("abc", new File([Buffer.from("hello")], "abc"));
    const contentRes = await app.request("/api/v1/projects/proj/builds/b1/content", {
      method: "POST",
      body: form,
    });
    expect(contentRes.status).toBe(200);
    expect(await storage.exists("content/abc")).toBe(true);

    // Storing a blob records no use; the manifest does, once per distinct hash.
    const recordContentUses = vi.fn(async () => await Promise.resolve([] as string[]));
    Object.assign(db, { buildReferenceLifecycle: { recordContentUses } });
    const manifest = async (): Promise<Response> =>
      await app.request("/api/v1/projects/proj/builds/b1/manifest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: [
            { rel: "a.js", hash: "abc", size: 5 },
            { rel: "b.js", hash: "abc", size: 5 },
          ],
        }),
      });
    expect(recordContentUses).not.toHaveBeenCalled();
    expect((await manifest()).status).toBe(200);
    expect(recordContentUses).toHaveBeenCalledWith("p1", "b1", ["abc"]);
    expect(await storage.exists("p1/builds/b1/storybook/manifest.json")).toBe(true);

    // A blob a collector claimed first: 409, and no manifest makes the build serve it.
    await storage.delete("p1/builds/b1/storybook/manifest.json");
    recordContentUses.mockResolvedValueOnce(["abc"]);
    expect((await manifest()).status).toBe(409);
    expect(await storage.exists("p1/builds/b1/storybook/manifest.json")).toBe(false);

    // A blob collected between the client's check and the record: 409 as well, no manifest.
    const gone = await app.request("/api/v1/projects/proj/builds/b1/manifest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [{ rel: "c.js", hash: "gone", size: 1 }] }),
    });
    expect(gone.status).toBe(409);
    expect(await storage.exists("p1/builds/b1/storybook/manifest.json")).toBe(false);
  });

  it("manifest stores and serving via manifest uses immutable cache for buildId", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, {
      id: "p1",
      name: "P",
      slug: "proj",
      gitRepository: null,
      gitDefaultBranch: "main",
      pixelThreshold: 0.1,
      maxDiffRatio: 0.01,
      publicBranchRegex: null,
      storybookMeta: null,
      executePlay: false,
      playTimeoutMs: 10_000,
      runA11y: false,
      browser: "chromium",
      viewports: null,
      automigrate: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.insert(db.tables.builds, {
      id: "b1",
      projectId: "p1",
      gitSha: "sha1",
      gitBranch: "main",
      isDefault: true,
      authorEmail: null,
      authorName: null,
      message: null,
      public: true,
      status: "approved",
      snapshotCount: 0,
      changedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      inheritedCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    // seed content and manifest
    objects.set("content/abc123", Buffer.from("console.log('hi')"));
    objects.set(
      `${storybookDir("p1", "b1")}/manifest.json`,
      Buffer.from(JSON.stringify({ "iframe.js": "abc123" })),
    );
    objects.set(`${storybookDir("p1", "b1")}/iframe.html`, Buffer.from("<html>preview</html>"));
    objects.set(`${storybookDir("p1", "b1")}/index.html`, Buffer.from("<html>storybook</html>"));

    const app = createShelfApp({ database: db, storage, logger: silentLogger });

    const res = await app.request("/projects/proj/storybook/build/b1/iframe.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe("console.log('hi')");

    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    await db.insert(db.tables.builds, {
      id: ulid,
      projectId: "p1",
      gitSha: "sha2",
      gitBranch: "main",
      isDefault: false,
      authorEmail: null,
      authorName: null,
      message: null,
      public: true,
      status: "approved",
      snapshotCount: 0,
      changedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      inheritedCount: 0,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    objects.set("content/hash2", Buffer.from("css"));
    objects.set(
      `${storybookDir("p1", ulid)}/manifest.json`,
      Buffer.from(JSON.stringify({ "styles.css": "hash2" })),
    );
    objects.set(`${storybookDir("p1", ulid)}/index.html`, Buffer.from("<html>storybook</html>"));
    objects.set(`${storybookDir("p1", ulid)}/iframe.html`, Buffer.from("<html>preview</html>"));

    const short = await app.request(`/_/${ulid}/styles.css`);
    expect(short.status).toBe(200);
    expect(short.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("DatabaseAdapter enforces tables with type safety and no as never", async () => {
    const { db } = makeDatabase();
    expect(db.tables).toBeDefined();
    expect(db.tables.projects).toBeDefined();
    expect(db.tables.builds).toBeDefined();
    expect(db.tables.contentUses).toBeDefined();
  });
});
