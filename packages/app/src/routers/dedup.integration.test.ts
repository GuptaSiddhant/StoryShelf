import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { storybookDir } from "@storyshelf/core/utils";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

/** A well-formed content hash: 64 lowercase hex digits. */
const hashOf = (digit: string): string => digit.repeat(64);
const A = hashOf("a");
const B = hashOf("b");
const C = hashOf("c");
const D = hashOf("d");

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
      body: JSON.stringify({ hashes: [A, B] }),
    });
    expect(dedupRes.status).toBe(200);
    const dedupBody = (await dedupRes.json()) as { needed: string[] };
    expect(dedupBody.needed).toEqual([A, B]);

    // upload one hash
    const form = new FormData();
    form.set(A, new File([Buffer.from("hello")], "a"));
    const contentRes = await app.request("/api/v1/projects/proj/builds/b1/content", {
      method: "POST",
      body: form,
    });
    expect(contentRes.status).toBe(200);
    expect(await storage.exists(`content/${A}`)).toBe(true);
    const ref = await db.get(db.tables.contentRefs, A);
    expect(ref).not.toBeNull();
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
    objects.set(`content/${C}`, Buffer.from("console.log('hi')"));
    objects.set(
      `${storybookDir("p1", "b1")}/manifest.json`,
      Buffer.from(JSON.stringify({ "iframe.js": C })),
    );
    objects.set(`${storybookDir("p1", "b1")}/iframe.html`, Buffer.from("<html>preview</html>"));
    objects.set(`${storybookDir("p1", "b1")}/index.html`, Buffer.from("<html>storybook</html>"));
    await db.insert(db.tables.contentRefs, {
      hash: C,
      refCount: 1,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

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
    objects.set(`content/${D}`, Buffer.from("css"));
    objects.set(
      `${storybookDir("p1", ulid)}/manifest.json`,
      Buffer.from(JSON.stringify({ "styles.css": D })),
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
    expect(db.tables.contentRefs).toBeDefined();
    // type-safe insert without as never
    await db.insert(db.tables.contentRefs, {
      hash: "h1",
      refCount: 1,
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const got = await db.get(db.tables.contentRefs, "h1");
    expect(got).not.toBeNull();
  });
});

/** Hashes that must never reach a storage key: traversal, separators, wrong case or length, empty. */
const BAD_HASHES = [
  "..",
  "../p1/builds/b1/storybook/index.html",
  `${"a".repeat(30)}/${"a".repeat(33)}`,
  "A".repeat(64),
  "a".repeat(63),
  "a".repeat(65),
  "",
];

async function seedUploadTarget() {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const now = "2026-01-01T00:00:00.000Z";
  await db.insert(db.tables.projects, {
    id: "p1",
    name: "P",
    slug: "proj",
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(db.tables.builds, {
    id: "b1",
    projectId: "p1",
    gitSha: "sha1",
    gitBranch: "main",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  const calls = [
    vi.spyOn(storage, "exists"),
    vi.spyOn(storage, "write"),
    vi.spyOn(storage, "read"),
    vi.spyOn(storage, "delete"),
  ];
  const app = createShelfApp({ database: db, storage, logger: silentLogger });
  const keysBefore = [...objects.keys()];
  return { app, calls, objects, keysBefore };
}

const JSON_HEADERS = { "content-type": "application/json" };
const BASE = "/api/v1/projects/proj/builds/b1";

describe("content hashes are validated before they become storage keys", () => {
  it.each(BAD_HASHES)("dedup refuses %j and touches no storage", async (hash) => {
    const { app, calls } = await seedUploadTarget();
    const res = await app.request(`${BASE}/dedup`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ hashes: [hash] }),
    });
    expect(res.status).toBe(400);
    for (const spy of calls) expect(spy).not.toHaveBeenCalled();
  });

  it.each(BAD_HASHES)("manifest refuses %j and writes nothing", async (hash) => {
    const { app, calls, objects, keysBefore } = await seedUploadTarget();
    const res = await app.request(`${BASE}/manifest`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ files: [{ rel: "iframe.js", hash, size: 1 }] }),
    });
    expect(res.status).toBe(400);
    for (const spy of calls) expect(spy).not.toHaveBeenCalled();
    expect([...objects.keys()]).toEqual(keysBefore);
  });

  it.each(BAD_HASHES)("multipart upload refuses the key %j and writes nothing", async (hash) => {
    const { app, calls, objects, keysBefore } = await seedUploadTarget();
    const form = new FormData();
    form.set(A, new File([Buffer.from("fine")], "ok"));
    form.set(hash, new File([Buffer.from("evil")], "bad"));
    const res = await app.request(`${BASE}/content`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    // The bad key is found before anything is written: not even the good file lands.
    for (const spy of calls) expect(spy).not.toHaveBeenCalled();
    expect([...objects.keys()]).toEqual(keysBefore);
  });

  it.each(BAD_HASHES)(
    "a single-file upload with the X-Content-Hash %j writes nothing (the route takes multipart only)",
    async (hash) => {
      const { app, calls, objects, keysBefore } = await seedUploadTarget();
      const res = await app.request(`${BASE}/content`, {
        method: "POST",
        headers: { "x-content-hash": hash, "content-type": "application/octet-stream" },
        body: "evil",
      });
      // The OpenAPI body schema refuses anything but multipart before the handler runs; the
      // handler's own check on that header (and `contentKey`) is a second line behind it.
      expect(res.status).toBe(415);
      for (const spy of calls) expect(spy).not.toHaveBeenCalled();
      expect([...objects.keys()]).toEqual(keysBefore);
    },
  );

  it("still accepts a well-formed hash on every entry point", async () => {
    const { app, objects } = await seedUploadTarget();
    const dedup = await app.request(`${BASE}/dedup`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ hashes: [A] }),
    });
    expect(dedup.status).toBe(200);
    const form = new FormData();
    form.set(B, new File([Buffer.from("bytes")], "b"));
    const upload = await app.request(`${BASE}/content`, { method: "POST", body: form });
    expect(upload.status).toBe(200);
    expect(objects.has(`content/${B}`)).toBe(true);
    const manifest = await app.request(`${BASE}/manifest`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ files: [{ rel: "iframe.js", hash: B, size: 5 }] }),
    });
    expect(manifest.status).toBe(200);
  });
});
