/**
 * Browser-private caching of capture-scoped signed Storybook assets (ADR 0007, decision 5), against
 * a real Chromium and the real signed route. The evidence is the server's own request count for the
 * asset, plus Chromium's `requestServedFromCache`: two manual HTTP requests would prove nothing
 * about a browser. A capture pass that shares one browser context across stories is the
 * deliberately cache-sharing scope; a fresh context always starts cold. Gated by
 * `RUN_INTEGRATION=1` like the rest.
 */
import { serve } from "@hono/node-server";
import { createShelfApp } from "@storyshelf/app";
import {
  createTestBuild,
  createTestProject,
  makeDatabase,
  makeStorage,
} from "@storyshelf/core/test-helpers";
import { signStorybookToken, storybookDir } from "@storyshelf/core/utils";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlaywrightCaptureRunner } from "./capture-runner.ts";

const SECRET = "signed-cache-secret-signed-cache-secret";
const ASSET = Buffer.from("globalThis.assetRuns = (globalThis.assetRuns ?? 0) + 1;\n".repeat(50));
const HASH = createHash("sha256").update(ASSET).digest("hex");
const PAGE = (name: string): string => `<script src="assets/app.js"></script><p>${name}</p>`;

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
  });
}

interface Shelf {
  origin: string;
  /**
   * A signed root URL for the build: a render-pass `capture` token at `/_s/`, or a `read` grant (an
   * interactive preview) at `/_r/`. A different `ttlSeconds` gives a different token and so a
   * different URL, with no waiting.
   */
  rootUrl: (options?: { purpose?: "capture" | "read"; ttlSeconds?: number }) => string;
  /** How many requests the server has answered for the asset. */
  assetRequests: () => number;
  close: () => Promise<void>;
}

async function startShelf(cacheMaxAgeSeconds?: number): Promise<Shelf> {
  const { db } = makeDatabase();
  const { storage, objects } = makeStorage();
  const project = await createTestProject(db, db.tables, { name: "Signed cache" });
  const build = await createTestBuild(db, db.tables, project.id, { gitBranch: "feature" });
  const dir = storybookDir(project.id, build.id);
  objects.set(`${dir}/manifest.json`, Buffer.from(JSON.stringify({ "assets/app.js": HASH })));
  objects.set(`content/${HASH}`, ASSET);
  objects.set(`${dir}/page-a.html`, Buffer.from(PAGE("a")));
  objects.set(`${dir}/page-b.html`, Buffer.from(PAGE("b")));
  const app = createShelfApp({
    database: db,
    storage,
    testing: { runner: createPlaywrightCaptureRunner() },
    config: {
      secret: SECRET,
      ...(cacheMaxAgeSeconds === undefined ? {} : { captureAssets: { cacheMaxAgeSeconds } }),
    },
  });
  await app.lifecycle.setup();
  let hits = 0;
  const port = await freePort();
  const listener = serve({
    fetch: (request) => {
      if (new URL(request.url).pathname.endsWith("/assets/app.js")) {
        hits += 1;
      }
      return app.fetch(request);
    },
    port,
    hostname: "127.0.0.1",
  });
  const origin = `http://127.0.0.1:${String(port)}`;
  return {
    origin,
    rootUrl: ({ purpose = "capture", ttlSeconds = 3600 } = {}) =>
      `${origin}${purpose === "read" ? "/_r/" : "/_s/"}${signStorybookToken({
        secret: SECRET,
        projectId: project.id,
        buildId: build.id,
        ttlSeconds,
        purpose,
      })}/`,
    assetRequests: () => hits,
    close: async () => {
      listener.close();
      await app.lifecycle.teardown();
    },
  };
}

/** Load page a then page b in one browser page and report how many loads came from the cache. */
async function visitTwice(context: BrowserContext, root: string): Promise<number> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const served: string[] = [];
  await cdp.send("Network.enable");
  cdp.on("Network.requestServedFromCache", ({ requestId }) => served.push(requestId));
  await page.goto(`${root}page-a.html`);
  await page.goto(`${root}page-b.html`);
  await page.close();
  return served.length;
}

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")(
  "capture-scoped signed asset caching in a real browser",
  () => {
    let browser: Browser;
    const shelves: Shelf[] = [];

    const shelf = async (cacheMaxAgeSeconds?: number): Promise<Shelf> => {
      const started = await startShelf(cacheMaxAgeSeconds);
      shelves.push(started);
      return started;
    };

    beforeAll(async () => {
      browser = await chromium.launch(
        process.env["CHROMIUM_EXECUTABLE_PATH"]
          ? { executablePath: process.env["CHROMIUM_EXECUTABLE_PATH"] }
          : {},
      );
    }, 60_000);

    afterAll(async () => {
      await browser.close();
      await Promise.all(shelves.map(async (started) => await started.close()));
    });

    it("fetches the asset once across stories of one shared context when opted in", async () => {
      const opted = await shelf(600);
      const context = await browser.newContext();
      const fromCache = await visitTwice(context, opted.rootUrl());
      expect(opted.assetRequests()).toBe(1);
      expect(fromCache).toBeGreaterThanOrEqual(1);
      await context.close();
    });

    it("fetches it every time by default, whatever the grant", async () => {
      const off = await shelf();
      const context = await browser.newContext();
      const fromCache = await visitTwice(context, off.rootUrl());
      expect(off.assetRequests()).toBe(2);
      expect(fromCache).toBe(0);
      await context.close();
    });

    it("never caches an interactive preview's read grant, even when opted in", async () => {
      const opted = await shelf(600);
      const context = await browser.newContext();
      await visitTwice(context, opted.rootUrl({ purpose: "read" }));
      expect(opted.assetRequests()).toBe(2);
      await context.close();
    });

    it("starts cold in a fresh isolated context", async () => {
      const opted = await shelf(600);
      const root = opted.rootUrl();
      const first = await browser.newContext();
      await visitTwice(first, root);
      expect(opted.assetRequests()).toBe(1);
      const second = await browser.newContext();
      const fromCache = await visitTwice(second, root);
      expect(opted.assetRequests()).toBe(2);
      expect(fromCache).toBeGreaterThanOrEqual(1);
      await first.close();
      await second.close();
    });

    it("treats a renewed grant's new URL as a new cache identity", async () => {
      const opted = await shelf(600);
      const context = await browser.newContext();
      await visitTwice(context, opted.rootUrl());
      expect(opted.assetRequests()).toBe(1);
      await visitTwice(context, opted.rootUrl({ ttlSeconds: 3500 }));
      expect(opted.assetRequests()).toBe(2);
      await context.close();
    });
  },
);
