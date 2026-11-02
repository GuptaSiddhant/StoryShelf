import type { RemoteBrowser } from "@storyshelf/core/adapter/capture-runner";
import type { Logger } from "@storyshelf/core/logger";
import { describe, expect, it, vi } from "vitest";
import { measureRemote } from "./remote-environment.ts";
import type { BrowserSession } from "./session.ts";

const PROBE = { platform: "Linux x86_64", deviceScaleFactor: 1, fonts: ["Arial"] };

function remote(probeMs: number): RemoteBrowser {
  return { platform: "linux-x64", timeouts: { probeMs } } as unknown as RemoteBrowser;
}

function fakePage(evaluate: () => Promise<unknown>) {
  return { evaluate: vi.fn(evaluate), close: vi.fn(async () => await Promise.resolve()) };
}

function fakeSession(newPage: () => Promise<unknown>) {
  const forgetPage = vi.fn();
  const session = {
    browser: { version: async () => await Promise.resolve("HeadlessChrome/141.0.1") },
    newPage: vi.fn(newPage),
    forgetPage,
  } as unknown as BrowserSession;
  return { session, forgetPage };
}

describe("measureRemote", () => {
  it("reports the version and what the page said, and closes and forgets the page", async () => {
    const page = fakePage(async () => await Promise.resolve(PROBE));
    const { session, forgetPage } = fakeSession(async () => await Promise.resolve(page));
    const environment = await measureRemote(session, remote(1000));
    expect(environment).toMatchObject({
      browserVersion: "HeadlessChrome/141.0.1",
      platform: "linux",
    });
    expect(environment.fontsHash).toBeDefined();
    expect(page.close).toHaveBeenCalledOnce();
    expect(forgetPage).toHaveBeenCalledWith(page);
  });

  it("keeps the browser version when only the page probe fails, and warns", async () => {
    const page = fakePage(async () => await Promise.reject(new Error("page crashed")));
    const warn = vi.fn();
    const { session } = fakeSession(async () => await Promise.resolve(page));
    const environment = await measureRemote(session, remote(1000), {
      logger: { warn } as unknown as Logger,
    });
    expect(environment).toEqual({
      browserVersion: "HeadlessChrome/141.0.1",
      platform: "linux-x64",
    });
    expect(warn).toHaveBeenCalledWith(
      { reason: expect.stringContaining("page crashed") },
      "could not measure the remote browser",
    );
    expect(page.close).toHaveBeenCalledOnce();
  });

  it("stops at probeMs with the version it already read, and closes the page it held", async () => {
    const page = fakePage(async () => await new Promise<never>(() => {}));
    const warn = vi.fn();
    const { session } = fakeSession(async () => await Promise.resolve(page));
    const environment = await measureRemote(session, remote(20), {
      logger: { warn } as unknown as Logger,
    });
    expect(environment).toEqual({
      browserVersion: "HeadlessChrome/141.0.1",
      platform: "linux-x64",
    });
    expect(warn).toHaveBeenCalledWith(
      { timeoutMs: 20 },
      "measuring the remote browser timed out; its environment is unknown",
    );
    expect(page.close).toHaveBeenCalledOnce();
  });

  it("does not leave a page that only opens after the limit", async () => {
    const opening = Promise.withResolvers<unknown>();
    const page = fakePage(async () => await Promise.resolve(PROBE));
    const { session, forgetPage } = fakeSession(async () => await opening.promise);
    const environment = await measureRemote(session, remote(20));
    expect(environment.fontsHash).toBeUndefined();
    expect(page.close).not.toHaveBeenCalled();
    opening.resolve(page);
    await new Promise((resolve) => setImmediate(resolve));
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalledOnce();
    expect(forgetPage).toHaveBeenCalledWith(page);
  });

  it("stops the run when cancelled mid-probe and closes the page, with no warning", async () => {
    const controller = new AbortController();
    const page = fakePage(async () => await new Promise<never>(() => {}));
    const warn = vi.fn();
    const { session, forgetPage } = fakeSession(async () => await Promise.resolve(page));
    const pending = measureRemote(session, remote(60_000), {
      signal: controller.signal,
      logger: { warn } as unknown as Logger,
    });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(pending).rejects.toThrow("Capture cancelled");
    expect(page.close).toHaveBeenCalledOnce();
    expect(forgetPage).toHaveBeenCalledWith(page);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not open a page for a run that is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { session } = fakeSession(async () => await Promise.resolve(fakePage(async () => PROBE)));
    await expect(
      measureRemote(session, remote(1000), { signal: controller.signal }),
    ).rejects.toThrow("Capture cancelled");
    expect(session.newPage).not.toHaveBeenCalled();
  });
});
