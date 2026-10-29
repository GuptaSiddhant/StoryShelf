import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";
import { createStaticServer } from "./static-server.ts";

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("loopback HTTP cache", () => {
  it("reuses responses in one context but starts cold in a new context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "storyshelf-cache-"));
    await writeFile(join(dir, "index.html"), '<script src="/asset.js"></script>');
    await writeFile(join(dir, "asset.js"), "globalThis.assetLoaded = true;");
    const server = await createStaticServer(dir);
    const browser = await chromium.launch(
      process.env["CHROMIUM_EXECUTABLE_PATH"]
        ? { executablePath: process.env["CHROMIUM_EXECUTABLE_PATH"] }
        : {},
    );
    try {
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
      await browser.close();
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
