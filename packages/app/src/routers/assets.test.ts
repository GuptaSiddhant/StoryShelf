import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { stubTables } from "@storyshelf/core/test-helpers";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { assetManifest } from "../asset-manifest.ts";
import { createShelfApp } from "../index.tsx";
import { stubAuth } from "../stub-auth.ts";
import { ICON_PATHS } from "../ui/icons/paths.ts";

const silentLogger = pino({ level: "silent" });

const dbFail = async (): Promise<never> => {
  return await Promise.reject(new Error("database not used in this test"));
};

const storageFail = async (): Promise<never> => {
  return await Promise.reject(new Error("storage not used in this test"));
};

function stubDatabase(): DatabaseAdapter {
  return {
    metadata: { name: "Stub DB", version: "0.0.0", kind: "stub", category: "database" },
    tables: stubTables(),
    insert: dbFail,
    update: dbFail,
    get: dbFail,
    remove: dbFail,
    list: dbFail,
    count: dbFail,
    all: dbFail,
  };
}

function stubStorage(): StorageAdapter {
  return {
    metadata: { name: "Stub Storage", version: "0.0.0", kind: "stub", category: "storage" },
    read: storageFail,
    write: storageFail,
    delete: storageFail,
    exists: storageFail,
    list: storageFail,
    writeStream: storageFail,
    readStream: storageFail,
  };
}

const noSessionAuth = stubAuth(null);

function makeApp(auth?: ReturnType<typeof stubAuth>): ReturnType<typeof createShelfApp> {
  return createShelfApp({
    database: stubDatabase(),
    storage: stubStorage(),
    ...(auth ? { auth } : {}),
    logger: silentLogger,
  });
}

describe("static assets", () => {
  it("serves htmx at its content-hashed URL as immutable JavaScript", async () => {
    const response = await makeApp().request(assetManifest.htmx.href);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    expect(response.headers.get("cache-control")).toContain("immutable");
    const body = await response.text();
    expect(body.length).toBeGreaterThan(1000);
    expect(body).toContain("htmx");
  });

  it("revalidates (never immutably caches) the legacy unversioned htmx URL", async () => {
    const response = await makeApp().request("/assets/htmx.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("cache-control")).not.toContain("immutable");
  });

  it("does not gate assets behind the UI auth redirect", async () => {
    const app = makeApp(noSessionAuth);
    expect((await app.request("/assets/htmx.js")).status).toBe(200);
    expect((await app.request(assetManifest.icons.href)).status).toBe(200);
  });
});

describe("icon sprite", () => {
  it("serves an SVG sprite with immutable caching and an ETag", async () => {
    const response = await makeApp().request(assetManifest.icons.href);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("etag")).toBe(`"${assetManifest.icons.hash}"`);
  });

  it("contains a symbol for every declared icon", async () => {
    const body = await (await makeApp().request(assetManifest.icons.href)).text();
    for (const name of Object.keys(ICON_PATHS)) {
      expect(body).toContain(`<symbol id="i-${name}"`);
    }
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    const response = await makeApp().request(assetManifest.icons.href, {
      headers: { "if-none-match": `"${assetManifest.icons.hash}"` },
    });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("serves the current sprite for a stale hash without caching it", async () => {
    const response = await makeApp().request("/assets/icons-0123456789.svg");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("<symbol");
  });

  it("404s for non-hash filenames", async () => {
    expect((await makeApp().request("/assets/icons-evil.svg")).status).toBe(404);
  });
});
