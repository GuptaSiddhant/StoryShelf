/**
 * `ETag` and `304` for manifest-backed published files: a repeated request carrying the tag is
 * answered from the manifest with no storage read, in every hosting mode and on every route that
 * serves files (`/_s/`, `/_r/`, the project path, both short links). A refusal is unchanged: a 304
 * is only ever answered after the route's access check granted the request.
 */
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { publishedGzipPath, signStorybookToken, storybookDir } from "@storyshelf/core/utils";
import { createHash } from "node:crypto";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

const BUILD = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const SECRET = "signed-url-secret-signed-url-secret";
const ASSET = Buffer.from("console.log('asset');".repeat(40));
const HASH = createHash("sha256").update(ASSET).digest("hex");
const ETAG = `"${HASH}"`;
const apps: ReturnType<typeof createShelfApp>[] = [];
const admin = { id: "u1", email: "a@example.com", name: "A", role: "admin" } as const;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

const project = (): Project =>
  ({
    id: "p1",
    name: "p1",
    slug: "test-project",
    gitRepository: "owner/repo",
    gitDefaultBranch: "main",
    pixelThreshold: 0.1,
    maxDiffRatio: 0.01,
    publicBranchRegex: null,
    executePlay: false,
    playTimeoutMs: 10_000,
    storybookMeta: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  }) as Project;

const build = (isPublic: boolean): Build =>
  ({
    id: BUILD,
    projectId: "p1",
    gitSha: "sha-build",
    gitBranch: "main",
    isDefault: true,
    public: isPublic,
    status: "approved",
    snapshotCount: 0,
    changedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    inheritedCount: 0,
    affectedOnly: true,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  }) as Build;

interface BootOptions {
  mode?: "trusted" | "sandboxed";
  publicBuild?: boolean;
  compression?: boolean;
  cacheMaxAgeSeconds?: number;
}

/** A build with one content-addressed asset (through the manifest) and one legacy per-build file. */
async function boot(options: BootOptions = {}) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, project());
  await db.insert(db.tables.builds, build(options.publicBuild === true));
  const dir = storybookDir("p1", BUILD);
  objects.set(`${dir}/manifest.json`, Buffer.from(JSON.stringify({ "assets/app.js": HASH })));
  objects.set(`content/${HASH}`, ASSET);
  objects.set(`${dir}/legacy.js`, Buffer.from("legacy copy"));
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    auth: stubAuth(admin),
    testing: { runner: stubRunner() },
    config: {
      secret: SECRET,
      ...(options.mode ? { storybookHosting: { mode: options.mode } } : {}),
      ...(options.compression ? { publishedCompression: true } : {}),
      ...(options.cacheMaxAgeSeconds
        ? { captureAssets: { cacheMaxAgeSeconds: options.cacheMaxAgeSeconds } }
        : {}),
    },
  });
  apps.push(app);
  const reads = (): number => readSpies.reduce((total, spy) => total + spy.mock.calls.length, 0);
  const readSpies = [vi.spyOn(storage, "read"), vi.spyOn(storage, "readStream")];
  const resetReads = (): void => {
    for (const spy of readSpies) spy.mockClear();
  };
  return { app, objects, reads, resetReads };
}

const token = (purpose: "capture" | "read", buildId = BUILD): string =>
  signStorybookToken({ secret: SECRET, projectId: "p1", buildId, purpose });

const ROUTES = [
  ["the project path", () => `/projects/test-project/storybook/build/${BUILD}/assets/app.js`, true],
  ["the ULID/id short link", () => `/_/${BUILD}/assets/app.js`, true],
  ["the slug short link", () => "/_/test-project/assets/app.js", true],
  ["a signed capture URL", () => `/_s/${token("capture")}/assets/app.js`, false],
  ["a read grant", () => `/_r/${token("read")}/assets/app.js`, false],
] as const;

describe.each(["trusted", "sandboxed"] as const)("%s hosting mode", (mode) => {
  it.each(ROUTES)("answers %s with an ETag, then 304 with no storage read", async (_n, path) => {
    const { app, reads, resetReads } = await boot({ mode, publicBuild: true });
    const first = await app.request(path());
    expect(first.status).toBe(200);
    expect(first.headers.get("etag")).toBe(ETAG);
    expect(await first.text()).toBe(ASSET.toString());
    resetReads();
    const again = await app.request(path(), { headers: { "if-none-match": ETAG } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(ETAG);
    expect(reads()).toBe(0);
    for (const name of ["cache-control", "content-security-policy", "referrer-policy"]) {
      expect(again.headers.get(name)).toBe(first.headers.get(name));
    }
  });

  it.each(ROUTES)("answers %s in full for a stale or absent tag", async (_n, path) => {
    const { app } = await boot({ mode, publicBuild: true });
    const stale = await app.request(path(), { headers: { "if-none-match": '"other"' } });
    expect(stale.status).toBe(200);
    expect(stale.headers.get("etag")).toBe(ETAG);
  });
});

describe("304 and access", () => {
  it("keeps a signed answer's headers on a 304 and never lets a caller widen them", async () => {
    const { app } = await boot();
    const path = `/_s/${token("capture")}/assets/app.js`;
    const response = await app.request(path, { headers: { "if-none-match": ETAG } });
    expect(response.status).toBe(304);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).not.toMatch(/public|s-maxage/u);
  });

  it("gives a signed answer allowed freshness the same on a 304", async () => {
    const { app } = await boot({ cacheMaxAgeSeconds: 600 });
    const path = `/_s/${token("capture")}/assets/app.js`;
    const full = await app.request(path);
    const response = await app.request(path, { headers: { "if-none-match": ETAG } });
    expect(response.status).toBe(304);
    expect(response.headers.get("cache-control")).toBe(full.headers.get("cache-control"));
  });

  it("refuses a bad or wrong-purpose token exactly as before, even with a matching tag", async () => {
    const { app } = await boot();
    const headers = { "if-none-match": ETAG };
    const refusals = [
      await app.request(`/_s/garbage/assets/app.js`, { headers }),
      await app.request(`/_s/${token("read")}/assets/app.js`, { headers }),
      await app.request(`/_r/${token("capture")}/assets/app.js`, { headers }),
      await app.request(`/_s/${token("capture", "other")}/assets/app.js`, { headers }),
    ];
    const bodies = await Promise.all(refusals.map(async (refused) => await refused.text()));
    expect(bodies).toEqual(refusals.map(() => "Not found"));
    for (const refused of refusals) {
      expect(refused.status).toBe(404);
      expect(refused.headers.get("etag")).toBeNull();
      expect(refused.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("sends a signed-out viewer of a private build to the same refusal with or without a tag", async () => {
    const { db } = makeDatabase();
    const { storage, objects } = makeStorage();
    await db.insert(db.tables.projects, project());
    await db.insert(db.tables.builds, build(false));
    objects.set(`${storybookDir("p1", BUILD)}/manifest.json`, Buffer.from(`{"a.js":"${HASH}"}`));
    objects.set(`content/${HASH}`, ASSET);
    const app = createShelfApp({
      database: db,
      storage,
      logger: pino({ level: "silent" }),
      auth: stubAuth(null),
    });
    apps.push(app);
    const url = `/projects/test-project/storybook/build/${BUILD}/a.js`;
    const plain = await app.request(url);
    const tagged = await app.request(url, { headers: { "if-none-match": ETAG } });
    expect(tagged.status).toBe(plain.status);
    expect(tagged.status).not.toBe(304);
    expect(tagged.headers.get("etag")).toBeNull();
  });
});

describe("what carries no tag, and compression", () => {
  it("sends no ETag for a public legacy file, and never a 304", async () => {
    const { app } = await boot({ publicBuild: true });
    const url = `/projects/test-project/storybook/build/${BUILD}/legacy.js`;
    const first = await app.request(url);
    expect(first.status).toBe(200);
    expect(first.headers.get("etag")).toBeNull();
    const again = await app.request(url, { headers: { "if-none-match": ETAG } });
    expect(again.status).toBe(200);
  });

  it("gives the gzip copy its own tag and answers it with a 304 without reading storage", async () => {
    const { app, objects, reads, resetReads } = await boot({
      publicBuild: true,
      compression: true,
    });
    const url = `/projects/test-project/storybook/build/${BUILD}/assets/app.js`;
    const headers = { "accept-encoding": "gzip" };
    await app.request(url, { headers });
    await vi.waitFor(() => expect(objects.has(publishedGzipPath(HASH))).toBe(true));
    const gzipped = await app.request(url, { headers });
    expect(gzipped.headers.get("content-encoding")).toBe("gzip");
    expect(gzipped.headers.get("etag")).toBe(`"${HASH}-gzip"`);
    resetReads();
    const again = await app.request(url, {
      headers: { ...headers, "if-none-match": `"${HASH}-gzip"` },
    });
    expect(again.status).toBe(304);
    expect(again.headers.get("vary")).toBe("Accept-Encoding");
    expect(reads()).toBe(0);
  });
});
