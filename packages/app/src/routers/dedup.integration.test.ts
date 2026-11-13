import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { storybookDir } from "@storyshelf/core/utils";
import { createHash } from "node:crypto";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";

const silentLogger = pino({ level: "silent" });

/** A well-formed content hash: 64 lowercase hex digits. */
const hashOf = (digit: string): string => digit.repeat(64);
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
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

    const HELLO = sha256("hello");
    // upload one hash
    const form = new FormData();
    form.set(sha256("hello"), new File([Buffer.from("hello")], "a"));
    const contentRes = await app.request("/api/v1/projects/proj/builds/b1/content", {
      method: "POST",
      body: form,
    });
    expect(contentRes.status).toBe(200);
    expect(await storage.exists(`content/${sha256("hello")}`)).toBe(true);

    // Storing a blob records no use; the manifest does, once per distinct hash.
    const recordContentUses = vi.fn(async () => await Promise.resolve([] as string[]));
    Object.assign(db, { buildReferenceLifecycle: { recordContentUses } });
    const stamp = "2026-01-01T00:00:00.000Z";
    for (const id of ["b2", "b3"]) {
      // oxlint-disable-next-line no-await-in-loop -- two seed rows
      await db.insert(db.tables.builds, {
        id,
        projectId: "p1",
        gitSha: id,
        gitBranch: "main",
        isDefault: false,
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
        createdAt: stamp,
        updatedAt: stamp,
      });
    }
    const manifest = async (id = "b1"): Promise<Response> =>
      await app.request(`/api/v1/projects/proj/builds/${id}/manifest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: [
            { rel: "a.js", hash: HELLO, size: 5 },
            { rel: "b.js", hash: HELLO, size: 5 },
          ],
        }),
      });
    expect(recordContentUses).not.toHaveBeenCalled();
    expect((await manifest()).status).toBe(200);
    expect(recordContentUses).toHaveBeenCalledWith("p1", "b1", [HELLO], expect.any(String));
    expect(await storage.exists("p1/builds/b1/storybook/manifest.json")).toBe(true);

    // A blob a collector claimed first: 409, and no manifest makes the build serve it.
    recordContentUses.mockResolvedValueOnce([HELLO]);
    expect((await manifest("b2")).status).toBe(409);
    expect(await storage.exists("p1/builds/b2/storybook/manifest.json")).toBe(false);

    // A blob collected between the client's check and the record: 409 as well, no manifest.
    const gone = await app.request("/api/v1/projects/proj/builds/b3/manifest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [{ rel: "c.js", hash: hashOf("9"), size: 1 }] }),
    });
    expect(gone.status).toBe(409);
    expect(await storage.exists("p1/builds/b3/storybook/manifest.json")).toBe(false);
  });

  it("accepts one manifest per build: the same again is a no-op, another is a 409, a failed publish frees it", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const stamp = "2026-01-01T00:00:00.000Z";
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
      createdAt: stamp,
      updatedAt: stamp,
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
      createdAt: stamp,
      updatedAt: stamp,
    });
    const app = createShelfApp({ database: db, storage, logger: silentLogger });
    const post = async (hash: string): Promise<Response> =>
      await app.request("/api/v1/projects/proj/builds/b1/manifest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: [{ rel: "a.js", hash, size: 1 }] }),
      });
    const [first, second] = await Promise.all([post(A), post(A)]);
    expect([first?.status, second?.status]).toEqual([200, 200]);
    expect((await post(B)).status).toBe(409);
    expect((await post(A)).status).toBe(200);
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
    expect(db.tables.contentUses).toBeDefined();
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
    form.set(sha256("fine"), new File([Buffer.from("fine")], "ok"));
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

  it("refuses bytes that do not hash to the name they are uploaded under, and writes nothing", async () => {
    const { app, calls, objects, keysBefore } = await seedUploadTarget();
    const form = new FormData();
    form.set(sha256("fine"), new File([Buffer.from("fine")], "ok"));
    // A valid-looking hash that is not the digest of these bytes: planted content for someone else.
    form.set(A, new File([Buffer.from("planted")], "bad"));
    const res = await app.request(`${BASE}/content`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    for (const spy of calls) expect(spy).not.toHaveBeenCalled();
    expect([...objects.keys()]).toEqual(keysBefore);
  });

  it("refuses a form with a text field next to a file, and writes nothing", async () => {
    const { app, calls, objects, keysBefore } = await seedUploadTarget();
    const form = new FormData();
    form.set(sha256("fine"), new File([Buffer.from("fine")], "ok"));
    form.set(B, "not a file");
    const res = await app.request(`${BASE}/content`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    for (const spy of calls) expect(spy).not.toHaveBeenCalled();
    expect([...objects.keys()]).toEqual(keysBefore);
  });

  it("still accepts a well-formed hash on every entry point", async () => {
    const { app, objects } = await seedUploadTarget();
    const dedup = await app.request(`${BASE}/dedup`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ hashes: [A] }),
    });
    expect(dedup.status).toBe(200);
    const form = new FormData();
    form.set(sha256("bytes"), new File([Buffer.from("bytes")], "b"));
    const upload = await app.request(`${BASE}/content`, { method: "POST", body: form });
    expect(upload.status).toBe(200);
    expect(objects.has(`content/${sha256("bytes")}`)).toBe(true);
    const manifest = await app.request(`${BASE}/manifest`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ files: [{ rel: "iframe.js", hash: B, size: 5 }] }),
    });
    expect(manifest.status).toBe(200);
  });
});
