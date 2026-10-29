import type { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { screenshotWithRetry } from "./pipeline.ts";
import { createRuntimeParamsState } from "./runtime-params.ts";
import { createStaticServer, type StaticServer } from "./static-server.ts";
import type { CaptureContext, RunInput } from "./types.ts";

describe.skipIf(process.env["RUN_INTEGRATION"] !== "1")("remote capture retry", () => {
  it.each(["navigation", "screenshot", "crash"] as const)(
    "discards a %s failure's context and captures in a genuinely fresh one",
    async (phase) => {
      let dir: string | undefined;
      let browser: Browser | undefined;
      let server: StaticServer | undefined;
      try {
        dir = await mkdtemp(join(tmpdir(), "storyshelf-retry-"));
        await writeFile(
          join(dir, "index.html"),
          '<html><body><div id="storybook-root">retry</div></body></html>',
        );
        server = await createStaticServer(dir);
        browser = await chromium.launch(
          process.env["CHROMIUM_EXECUTABLE_PATH"]
            ? { executablePath: process.env["CHROMIUM_EXECUTABLE_PATH"] }
            : {},
        );
        const firstContext = await browser.newContext();
        const firstPage = await firstContext.newPage();
        const timeout = Object.assign(new Error("operation timed out"), { name: "TimeoutError" });
        if (phase === "navigation") vi.spyOn(firstPage, "goto").mockRejectedValueOnce(timeout);
        else if (phase === "screenshot")
          vi.spyOn(firstPage, "screenshot").mockRejectedValueOnce(timeout);
        else
          vi.spyOn(firstPage, "goto").mockImplementationOnce(async () => {
            (firstPage as unknown as EventEmitter).emit("crash", firstPage);
            throw new Error("page crashed");
          });
        const release = vi.fn(async () => await firstContext.close());
        const pool = { acquire: async () => ({ page: firstPage, release }) };
        const newPage = vi.spyOn(browser, "newPage");
        const ctx = {
          browser,
          pagePool: pool,
          adapter: { buildUrl: () => server!.url },
          baseUrl: server.url,
          runtimeParams: createRuntimeParamsState(),
        } as unknown as CaptureContext;
        const story = {
          id: "story",
          title: "Story",
          name: "Story",
          type: "story",
          parameters: {},
        } as const;
        const viewport = { name: "desktop", width: 800, height: 600 };
        const input = {
          buildId: "b",
          storybookDir: dir,
          stories: [story],
          viewports: [viewport],
          retryRemoteCapture: true,
        } as RunInput;
        const result = await screenshotWithRetry(ctx, story, viewport, input, {
          cancelled: false,
          browser,
          abort: new AbortController(),
        });
        expect(result.screenshot.length).toBeGreaterThan(0);
        expect(release).toHaveBeenCalledWith(false);
        expect(newPage).toHaveBeenCalledOnce();
        const retriedPage = await newPage.mock.results[0]!.value;
        expect(retriedPage.context()).not.toBe(firstContext);
        expect(browser.contexts()).not.toContain(firstContext);
      } finally {
        await browser?.close().catch(() => {});
        await server?.close().catch(() => {});
        if (dir) await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
