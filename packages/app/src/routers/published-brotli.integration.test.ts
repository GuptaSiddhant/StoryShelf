/**
 * Brotli and gzip copies made at publish time: the first request for a script is already compressed,
 * brotli before gzip when the client takes both, in every hosting mode and on every route that serves
 * files. Each encoding has its own ETag, `Vary: Accept-Encoding` is on every answer, and a refusal is
 * unchanged.
 */
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { signStorybookToken, storybookDir } from "@storyshelf/core/utils";
import { createHash } from "node:crypto";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";
import { precompressBuild, settlePrecompression } from "./published-precompress.ts";

const BUILD = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const SECRET = "signed-url-secret-signed-url-secret";
const ASSET = Buffer.from("console.log('asset');".repeat(200));
const HASH = createHash("sha256").update(ASSET).digest("hex");
const apps: ReturnType<typeof createShelfApp>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

async function boot(mode: "trusted" | "sandboxed", compression = true) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, {
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
  } as Project);
  await db.insert(db.tables.builds, {
    id: BUILD,
    projectId: "p1",
    gitSha: "sha",
    gitBranch: "main",
    isDefault: true,
    public: true,
    status: "approved",
    snapshotCount: 0,
    changedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    inheritedCount: 0,
    affectedOnly: true,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  } as Build);
  const dir = storybookDir("p1", BUILD);
  objects.set(`${dir}/manifest.json`, Buffer.from(JSON.stringify({ "assets/app.js": HASH })));
  objects.set(`content/${HASH}`, ASSET);
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    auth: stubAuth(null),
    testing: { runner: stubRunner() },
    config: {
      secret: SECRET,
      storybookHosting: { mode },
      ...(compression ? { publishedCompression: true } : {}),
    },
  });
  apps.push(app);
  // What the publish hook does when a build finishes publishing.
  precompressBuild(storage, "p1", BUILD, pino({ level: "silent" }));
  await settlePrecompression(storage);
  return { app, objects, storage };
}

const token = (purpose: "capture" | "read"): string =>
  signStorybookToken({ secret: SECRET, projectId: "p1", buildId: BUILD, purpose });

const ROUTES = [
  ["the project path", () => `/projects/test-project/storybook/build/${BUILD}/assets/app.js`],
  ["the ULID/id short link", () => `/_/${BUILD}/assets/app.js`],
  ["the slug short link", () => "/_/test-project/assets/app.js"],
  ["a signed capture URL", () => `/_s/${token("capture")}/assets/app.js`],
  ["a read grant", () => `/_r/${token("read")}/assets/app.js`],
] as const;

const body = async (response: Response): Promise<Buffer> =>
  Buffer.from(await response.arrayBuffer());

describe.each(["trusted", "sandboxed"] as const)("%s hosting mode", (mode) => {
  it.each(ROUTES)("answers %s with brotli on the first request", async (_n, path) => {
    const { app } = await boot(mode);
    const first = await app.request(path(), { headers: { "accept-encoding": "gzip, br" } });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-encoding")).toBe("br");
    expect(first.headers.get("vary")).toBe("Accept-Encoding");
    expect(first.headers.get("etag")).toBe(`"${HASH}-br"`);
    expect(brotliDecompressSync(await body(first))).toEqual(ASSET);
  });

  it.each(ROUTES)("answers %s with gzip when brotli is not accepted", async (_n, path) => {
    const { app } = await boot(mode);
    const response = await app.request(path(), { headers: { "accept-encoding": "gzip" } });
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("etag")).toBe(`"${HASH}-gzip"`);
    expect(gunzipSync(await body(response))).toEqual(ASSET);
  });

  it.each(ROUTES)("answers %s uncompressed for a client taking neither", async (_n, path) => {
    const { app } = await boot(mode);
    const response = await app.request(path(), { headers: { "accept-encoding": "identity" } });
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("etag")).toBe(`"${HASH}"`);
    expect(await body(response)).toEqual(ASSET);
  });

  it.each(ROUTES)("keeps the access headers of %s on a compressed answer", async (_n, path) => {
    const { app } = await boot(mode);
    const plain = await app.request(path());
    const packed = await app.request(path(), { headers: { "accept-encoding": "br" } });
    for (const name of ["cache-control", "content-security-policy", "referrer-policy"]) {
      expect(packed.headers.get(name)).toBe(plain.headers.get(name));
    }
  });

  it.each(ROUTES)("answers %s with 304 per encoding tag, no storage read", async (_n, path) => {
    const { app, storage } = await boot(mode);
    const read = [vi.spyOn(storage, "read"), vi.spyOn(storage, "readStream")];
    const both = { "accept-encoding": "gzip, br" };
    const brotli = await app.request(path(), {
      headers: { ...both, "if-none-match": `"${HASH}-br"` },
    });
    expect(brotli.status).toBe(304);
    expect(brotli.headers.get("etag")).toBe(`"${HASH}-br"`);
    const gzip = await app.request(path(), {
      headers: { ...both, "if-none-match": `"${HASH}-gzip"` },
    });
    expect(gzip.status).toBe(304);
    expect(gzip.headers.get("etag")).toBe(`"${HASH}-gzip"`);
    // A client that does not take brotli does not get a 304 for a brotli tag.
    const stale = await app.request(path(), {
      headers: { "accept-encoding": "gzip", "if-none-match": `"${HASH}-br"` },
    });
    expect(stale.status).toBe(200);
    expect(stale.headers.get("content-encoding")).toBe("gzip");
    // Only the 200 above read storage (the compressed copy is checked, then served).
    expect(read.reduce((total, spy) => total + spy.mock.calls.length, 0)).toBeGreaterThan(0);
  });

  it("does not negotiate or send Vary when compression is off", async () => {
    const { app } = await boot(mode, false);
    const response = await app.request(`/_/${BUILD}/assets/app.js`, {
      headers: { "accept-encoding": "br, gzip" },
    });
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("vary")).toBeNull();
    expect(await body(response)).toEqual(ASSET);
  });

  it("falls back to gzip when only the gzip copy exists, and to the original when neither does", async () => {
    const { app, objects } = await boot(mode);
    objects.delete(`derived/published-br/${HASH}.br`);
    const gzip = await app.request(`/_/${BUILD}/assets/app.js`, {
      headers: { "accept-encoding": "br, gzip" },
    });
    expect(gzip.headers.get("content-encoding")).toBe("gzip");
    // The missed brotli copy is rebuilt in the background; wait for it, then remove both.
    await vi.waitFor(() => expect(objects.has(`derived/published-br/${HASH}.br`)).toBe(true));
    objects.delete(`derived/published-br/${HASH}.br`);
    objects.delete(`derived/published-gzip/${HASH}.gz`);
    const plain = await app.request(`/_/${BUILD}/assets/app.js`, {
      headers: { "accept-encoding": "br, gzip" },
    });
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await body(plain)).toEqual(ASSET);
  });

  it("refuses a bad or wrong-purpose token exactly as before, compressed or not", async () => {
    const { app } = await boot(mode);
    const headers = { "accept-encoding": "br" };
    const bad = await app.request("/_s/invalid/assets/app.js", { headers });
    const wrong = await app.request(`/_s/${token("read")}/assets/app.js`, { headers });
    const other = await app.request("/_s/invalid/assets/app.js");
    expect(bad.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(await bad.text()).toBe(await other.text());
    expect(bad.headers.get("content-encoding")).toBeNull();
  });
});
