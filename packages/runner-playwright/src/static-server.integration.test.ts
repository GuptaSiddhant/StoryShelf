import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { describe, expect, it } from "vitest";
import { createStaticServer, type StaticServer } from "./static-server.ts";

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("loopback HTTP cache", () => {
  it("reuses responses in one context but starts cold in a new context", async () => {
    let dir: string | undefined;
    let server: StaticServer | undefined;
    let browser: Browser | undefined;
    try {
      dir = await mkdtemp(join(tmpdir(), "storyshelf-cache-"));
      await writeFile(join(dir, "index.html"), '<script src="/asset.js"></script>');
      await writeFile(join(dir, "asset.js"), "globalThis.assetLoaded = true;");
      server = await createStaticServer(dir);
      browser = await chromium.launch(
        process.env["CHROMIUM_EXECUTABLE_PATH"]
          ? { executablePath: process.env["CHROMIUM_EXECUTABLE_PATH"] }
          : {},
      );
      const context = await browser.newContext();
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const served: string[] = [];
      await cdp.send("Network.enable");
      cdp.on("Network.requestServedFromCache", ({ requestId }) => served.push(requestId));
      await page.goto(server.url);
      expect(served).toHaveLength(0);
      await page.goto(server.url);
      expect(served.length).toBeGreaterThanOrEqual(1);
      const fresh = await browser.newContext();
      const freshPage = await fresh.newPage();
      const freshCdp = await fresh.newCDPSession(freshPage);
      const cold: string[] = [];
      await freshCdp.send("Network.enable");
      freshCdp.on("Network.requestServedFromCache", ({ requestId }) => cold.push(requestId));
      await freshPage.goto(server.url);
      expect(cold).toHaveLength(0);
      await fresh.close();
      await context.close();
    } finally {
      await browser?.close().catch(() => {});
      await server?.close().catch(() => {});
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });
});
