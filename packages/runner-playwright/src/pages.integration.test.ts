import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { describe, expect, it } from "vite-plus/test";
import { PagePool } from "./pages.ts";
import { createStaticServer, type StaticServer } from "./static-server.ts";

const VIEWPORT = { name: "desktop", width: 800, height: 600 };

// A story that leaves a Cache Storage entry and a registered service worker behind.
const PAGE = `<html><body><script>
window.ready = (async () => {
  await (await caches.open("story-cache")).put("/x", new Response("x"));
  await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
})();
</script></body></html>`;

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("page reuse in a real browser", () => {
  it("comes back from a reset with no Cache Storage entry and no service worker", async () => {
    let dir: string | undefined;
    let server: StaticServer | undefined;
    let browser: Browser | undefined;
    try {
      dir = await mkdtemp(join(tmpdir(), "storyshelf-pages-"));
      await writeFile(join(dir, "index.html"), PAGE);
      await writeFile(join(dir, "sw.js"), "self.addEventListener('fetch', () => {});");
      server = await createStaticServer(dir);
      browser = await chromium.launch(
        process.env["CHROMIUM_EXECUTABLE_PATH"]
          ? { executablePath: process.env["CHROMIUM_EXECUTABLE_PATH"] }
          : {},
      );
      const pool = new PagePool(browser);
      const first = await pool.acquire(VIEWPORT);
      await first.page.goto(server.url);
      await first.page.evaluate(
        async () => await (globalThis as unknown as { ready: Promise<void> }).ready,
      );
      const before = await first.page.evaluate(async () => ({
        caches: await globalThis.caches.keys(),
        workers: (await navigator.serviceWorker.getRegistrations()).length,
      }));
      expect(before).toEqual({ caches: ["story-cache"], workers: 1 });

      await first.release(true);
      const second = await pool.acquire(VIEWPORT);
      expect(second.page).toBe(first.page);
      await second.page.goto(`${server.url.replace(/\/$/u, "")}/sw.js`);
      const after = await second.page.evaluate(async () => ({
        caches: await globalThis.caches.keys(),
        workers: (await navigator.serviceWorker.getRegistrations()).length,
      }));
      expect(after).toEqual({ caches: [], workers: 0 });
      await pool.dispose();
    } finally {
      await browser?.close();
      await server?.close();
      if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
