/**
 * Browser-private caching of capture-scoped signed Storybook assets (ADR 0007, decision 5): the
 * server opts a successful answer for a `capture` grant into `private, max-age=N`, and nothing
 * else: not an error, a preview grant, a legacy token, a per-build copy or the default config.
 */
import type { Build, Project } from "@storyshelf/core/schema";
import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { signStorybookToken, storybookDir } from "@storyshelf/core/utils";
import { createHash } from "node:crypto";
import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { stubRunner } from "../test-runner.ts";

const SECRET = "signed-url-secret-signed-url-secret";
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const ASSET = Buffer.from("console.log('asset');".repeat(400));
const HASH = createHash("sha256").update(ASSET).digest("hex");
const apps: ReturnType<typeof createShelfApp>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map(async (app) => await app.lifecycle.teardown()));
});

const project = (id: string): Project =>
  ({
    id,
    name: id,
    slug: id,
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

const build = (id: string, projectId: string): Build =>
  ({
    id,
    projectId,
    gitSha: `sha-${id}`,
    gitBranch: "feature",
    isDefault: false,
    public: false,
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

/** A build with one content-addressed asset (via the manifest) and one legacy per-build file. */
async function boot(config: Record<string, unknown> = {}) {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  await db.insert(db.tables.projects, project("p1"));
  await db.insert(db.tables.projects, project("p2"));
  await db.insert(db.tables.builds, build("b1", "p1"));
  await db.insert(db.tables.builds, build("b2", "p2"));
  const dir = storybookDir("p1", "b1");
  objects.set(`${dir}/manifest.json`, Buffer.from(JSON.stringify({ "assets/app.js": HASH })));
  objects.set(`content/${HASH}`, ASSET);
  objects.set(`${dir}/legacy.js`, Buffer.from("legacy copy"));
  const app = createShelfApp({
    database: db,
    storage,
    logger: pino({ level: "silent" }),
    auth: stubAuth(null),
    config: { secret: SECRET, ...config },
    testing: { runner: stubRunner() },
  });
  apps.push(app);
  const token = (
    options: { purpose?: "capture"; ttlSeconds?: number; buildId?: string; secret?: string } = {},
  ): string =>
    signStorybookToken({
      secret: options.secret ?? SECRET,
      projectId: options.buildId === "b2" ? "p2" : "p1",
      buildId: options.buildId ?? "b1",
      ttlSeconds: options.ttlSeconds ?? 7200,
      purpose: options.purpose,
      now: NOW,
    });
  return { app, db, token };
}

const get = async (
  app: Awaited<ReturnType<typeof boot>>["app"],
  token: string,
  path = "assets/app.js",
  headers: Record<string, string> = {},
) => await app.request(`/_s/${token}/${path}`, { headers });

/** Pin the server's clock (token expiry and response freshness both read `Date.now`). */
function atClock(offsetSeconds = 0): void {
  vi.spyOn(Date, "now").mockReturnValue(NOW + offsetSeconds * 1000);
}

describe("capture-scoped signed asset caching", () => {
  it("stays private, no-store by default, even for a capture grant", async () => {
    atClock();
    const { app, token } = await boot();
    const response = await get(app, token({ purpose: "capture" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const explicitZero = await boot({ captureAssets: { cacheMaxAgeSeconds: 0 } });
    const zero = await get(explicitZero.app, explicitZero.token({ purpose: "capture" }));
    expect(zero.headers.get("cache-control")).toBe("private, no-store");
  });

  it("opts a capture grant into private max-age at the configured cap", async () => {
    atClock();
    const { app, token } = await boot({ captureAssets: { cacheMaxAgeSeconds: 600 } });
    const response = await get(app, token({ purpose: "capture" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=600");
    expect(await response.text()).toBe(ASSET.toString());
  });

  it("keeps every other signed-URL header on a fresh answer", async () => {
    atClock();
    const { app, token } = await boot({ captureAssets: { cacheMaxAgeSeconds: 600 } });
    const response = await get(app, token({ purpose: "capture" }));
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("cache-control")).not.toMatch(/public|s-maxage/u);
  });

  it("never exceeds one hour, and the remaining grant lifetime caps it", async () => {
    atClock();
    const big = await boot({ captureAssets: { cacheMaxAgeSeconds: 3600 } });
    const long = await get(big.app, big.token({ purpose: "capture", ttlSeconds: 7200 }));
    expect(long.headers.get("cache-control")).toBe("private, max-age=3600");
    const short = await get(big.app, big.token({ purpose: "capture", ttlSeconds: 120 }));
    expect(short.headers.get("cache-control")).toBe("private, max-age=120");
  });

  it("shrinks with the clock and never outlives the token", async () => {
    const { app, token } = await boot({ captureAssets: { cacheMaxAgeSeconds: 3600 } });
    const t = token({ purpose: "capture", ttlSeconds: 120 });
    atClock(30);
    expect((await get(app, t)).headers.get("cache-control")).toBe("private, max-age=90");
    atClock(119.5);
    expect((await get(app, t)).headers.get("cache-control")).toBe("private, no-store");
    atClock(121);
    const expired = await get(app, t);
    expect(expired.status).toBe(404);
    expect(expired.headers.get("cache-control")).toBe("private, no-store");
  });

  it("gives an interactive preview grant and a legacy token no freshness", async () => {
    atClock();
    const { app, token } = await boot({ captureAssets: { cacheMaxAgeSeconds: 600 } });
    const preview = await get(app, token());
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
  });

  it("cannot be elevated by a caller: not by query, header or an edited payload", async () => {
    atClock();
    const { app, token } = await boot({ captureAssets: { cacheMaxAgeSeconds: 600 } });
    const plain = token();
    const asks = await get(app, plain, "assets/app.js?purpose=capture", {
      "x-storyshelf-purpose": "capture",
      "cache-control": "max-age=600",
    });
    expect(asks.headers.get("cache-control")).toBe("private, no-store");
    const [payload = "", signature = ""] = plain.split(".");
    const edited = Buffer.from(`${Buffer.from(payload, "base64url").toString()}:capture`).toString(
      "base64url",
    );
    const forged = await get(app, `${edited}.${signature}`);
    expect(forged.status).toBe(404);
    expect(forged.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers every refusal alike and never with freshness", async () => {
    atClock();
    const { app, token } = await boot({ captureAssets: { cacheMaxAgeSeconds: 600 } });
    const good = token({ purpose: "capture" });
    const [payload = "", signature = ""] = good.split(".");
    const refusals = [
      await get(app, "garbage"),
      await get(app, `${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`),
      await get(app, token({ purpose: "capture", secret: "another-secret" })),
      await get(app, token({ purpose: "capture", buildId: "b2" }), "iframe.html"),
      await get(app, good, "missing.js"),
      await get(app, good, "../secret.txt"),
    ];
    expect(refusals.map((response) => response.status)).toEqual(refusals.map(() => 404));
    for (const response of refusals) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(
      new Set(await Promise.all(refusals.map(async (response) => await response.text()))),
    ).toHaveProperty("size", 1);
  });

  it("gives a file outside the content-addressed manifest no freshness", async () => {
    atClock();
    const { app, token } = await boot({ captureAssets: { cacheMaxAgeSeconds: 600 } });
    const legacy = await get(app, token({ purpose: "capture" }), "legacy.js");
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("cache-control")).toBe("private, no-store");
  });

  it("checks authorization on every network request, so a purged build stops at once", async () => {
    atClock();
    const { app, db, token } = await boot({ captureAssets: { cacheMaxAgeSeconds: 600 } });
    const t = token({ purpose: "capture" });
    expect((await get(app, t)).headers.get("cache-control")).toBe("private, max-age=600");
    await db.remove(db.tables.builds, "b1");
    const after = await get(app, t);
    expect(after.status).toBe(404);
    expect(after.headers.get("cache-control")).toBe("private, no-store");
  });

  it("stops accepting a token after a secret rotation drops its key", async () => {
    atClock();
    const first = await boot({ captureAssets: { cacheMaxAgeSeconds: 600 } });
    const t = first.token({ purpose: "capture" });
    expect((await get(first.app, t)).status).toBe(200);
    const rotated = await boot({
      secret: "a-new-secret-a-new-secret-a-new-secret",
      captureAssets: { cacheMaxAgeSeconds: 600 },
    });
    expect((await get(rotated.app, t)).status).toBe(404);
  });

  it("keeps content negotiation: fresh with and without compression, Vary only when negotiating", async () => {
    atClock();
    const off = await boot({ captureAssets: { cacheMaxAgeSeconds: 600 } });
    const plain = await get(off.app, off.token({ purpose: "capture" }), "assets/app.js", {
      "accept-encoding": "gzip",
    });
    expect(plain.headers.get("cache-control")).toBe("private, max-age=600");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(plain.headers.get("vary")).toBeNull();

    const on = await boot({
      publishedCompression: true,
      captureAssets: { cacheMaxAgeSeconds: 600 },
    });
    const responses = await Promise.all(
      ["gzip", "identity"].map(
        async (encoding) =>
          await get(on.app, on.token({ purpose: "capture" }), "assets/app.js", {
            "accept-encoding": encoding,
          }),
      ),
    );
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("private, max-age=600");
      expect(response.headers.get("vary")).toBe("Accept-Encoding");
    }
  });
});
