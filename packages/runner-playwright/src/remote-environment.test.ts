import type { RemoteBrowser } from "@storyshelf/core/adapter/capture-runner";
import type { Logger } from "@storyshelf/core/logger";
import type { Browser } from "playwright-core";
import { describe, expect, it, vi } from "vite-plus/test";
import { measureRemote } from "./remote-environment.ts";

const PROBE = { platform: "Linux x86_64", deviceScaleFactor: 2, fonts: ["Arial", "DejaVu Sans"] };

function remote(probeMs: number): RemoteBrowser {
  return { platform: "linux-x64", timeouts: { probeMs } } as unknown as RemoteBrowser;
}

function logger(): { logger: Logger; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  return { logger: { warn } as unknown as Logger, warn };
}

/** A fake page whose `evaluate` the test settles, and a `close` it can count. */
function fakePage(evaluate: () => Promise<unknown>) {
  return { evaluate: vi.fn(evaluate), close: vi.fn(async () => await Promise.resolve()) };
}

function fakeBrowser(newPage: () => Promise<unknown>): Browser {
  return { version: () => "141.0.1", newPage: vi.fn(newPage) } as unknown as Browser;
}

describe("measureRemote", () => {
  it("builds the fingerprint from what the page reported and closes the page", async () => {
    const page = fakePage(async () => await Promise.resolve(PROBE));
    const environment = await measureRemote(
      fakeBrowser(async () => await Promise.resolve(page)),
      remote(1000),
    );
    expect(environment).toMatchObject({
      browserVersion: "141.0.1",
      platform: "linux",
      deviceScaleFactor: 2,
    });
    expect(environment.fontsHash).toBeDefined();
    expect(page.close).toHaveBeenCalledOnce();
  });

  it("leaves the environment unknown, with a warning, when the probe fails", async () => {
    const page = fakePage(async () => await Promise.reject(new Error("page crashed")));
    const log = logger();
    const environment = await measureRemote(
      fakeBrowser(async () => await Promise.resolve(page)),
      remote(1000),
      { logger: log.logger },
    );
    expect(environment).toEqual({ browserVersion: "141.0.1", platform: "linux-x64" });
    expect(log.warn).toHaveBeenCalledWith(
      { reason: expect.stringContaining("page crashed") },
      "could not measure the remote browser",
    );
    expect(page.close).toHaveBeenCalledOnce();
  });

  it("stops waiting at probeMs, warns, and closes the page the probe held", async () => {
    const page = fakePage(async () => await new Promise<never>(() => {}));
    const log = logger();
    const environment = await measureRemote(
      fakeBrowser(async () => await Promise.resolve(page)),
      remote(20),
      { logger: log.logger },
    );
    expect(environment).toEqual({ browserVersion: "141.0.1", platform: "linux-x64" });
    expect(log.warn).toHaveBeenCalledWith(
      { timeoutMs: 20 },
      "measuring the remote browser timed out; its environment is unknown",
    );
    expect(page.close).toHaveBeenCalledOnce();
  });

  it("closes a page that only opens after the limit, so nothing is left behind", async () => {
    const opening = Promise.withResolvers<unknown>();
    const page = fakePage(async () => await Promise.resolve(PROBE));
    const environment = await measureRemote(
      fakeBrowser(async () => await opening.promise),
      remote(20),
    );
    expect(environment.fontsHash).toBeUndefined();
    expect(page.close).not.toHaveBeenCalled();
    opening.resolve(page);
    await new Promise((resolve) => setImmediate(resolve));
    expect(page.close).toHaveBeenCalledOnce();
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("stops the run when cancelled mid-probe, closes the page, and never reports it as unknown", async () => {
    const controller = new AbortController();
    const page = fakePage(async () => await new Promise<never>(() => {}));
    const log = logger();
    const pending = measureRemote(
      fakeBrowser(async () => await Promise.resolve(page)),
      remote(60_000),
      { signal: controller.signal, logger: log.logger },
    );
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(pending).rejects.toThrow("Capture cancelled");
    expect(page.close).toHaveBeenCalledOnce();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("does not open a page for a run that is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const browser = fakeBrowser(async () => await Promise.resolve(fakePage(async () => PROBE)));
    await expect(
      measureRemote(browser, remote(1000), { signal: controller.signal }),
    ).rejects.toThrow("Capture cancelled");
    expect(browser.newPage).not.toHaveBeenCalled();
  });

  it("reads a failure caused by the cancel closing the browser as a cancel", async () => {
    const controller = new AbortController();
    const page = fakePage(async () => {
      controller.abort();
      return await Promise.reject(new Error("Target page, context or browser has been closed"));
    });
    await expect(
      measureRemote(
        fakeBrowser(async () => await Promise.resolve(page)),
        remote(1000),
        {
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow("Capture cancelled");
  });
});
