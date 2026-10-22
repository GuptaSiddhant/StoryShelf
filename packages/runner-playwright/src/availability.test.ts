import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyLocalTargets, type BrowserTypes } from "./availability.ts";
import { flattenBrowsers, local } from "./targets.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "storyshelf-browsers-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const types = (): BrowserTypes => ({
  chromium: { executablePath: () => join(root, "chromium-1200", "chrome-linux64", "chrome") },
  firefox: { executablePath: () => join(root, "firefox-1500", "firefox", "firefox") },
  webkit: { executablePath: () => join(root, "webkit-2300", "pw_run.sh") },
});

async function install(dir: string, file?: string): Promise<void> {
  await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, dir, file ?? "INSTALLATION_COMPLETE"), "");
}

const statusOf = (names: Parameters<typeof flattenBrowsers>[0]) =>
  Object.fromEntries(
    verifyLocalTargets(flattenBrowsers(names).locals, types()).map((entry) => [
      entry.target,
      entry.status,
    ]),
  );

describe("verifyLocalTargets", () => {
  it("marks a declared engine that is not installed unavailable, with how to install it", () => {
    const status = statusOf(["chromium", "firefox", "webkit"]);
    for (const engine of ["chromium", "firefox", "webkit"]) {
      expect(status[engine]).toEqual({
        unavailable: expect.stringContaining(`declared, not installed`),
      });
    }
    expect(status["firefox"]).toEqual({
      unavailable: expect.stringContaining("playwright install firefox"),
    });
  });

  it("reaches the Storybook through the loopback server", () => {
    expect(verifyLocalTargets(flattenBrowsers(["chromium"]).locals, types())[0]?.reach).toBe(
      "loopback",
    );
  });

  it("reads an install marker as installed", async () => {
    await install("firefox-1500");
    await install("webkit-2300");
    expect(statusOf(["firefox", "webkit", "chromium"])).toMatchObject({
      firefox: "ready",
      webkit: "ready",
      chromium: { unavailable: expect.any(String) },
    });
  });

  it("reads the executable itself as installed", async () => {
    await mkdir(join(root, "firefox-1500", "firefox"), { recursive: true });
    await writeFile(join(root, "firefox-1500", "firefox", "firefox"), "");
    expect(statusOf(["firefox"])["firefox"]).toBe("ready");
  });

  it("finds Chromium through its headless shell, the binary headless launches use", async () => {
    await install("chromium_headless_shell-1200");
    expect(statusOf(["chromium"])["chromium"]).toBe("ready");
  });

  it("does not take another revision's install for this one", async () => {
    await install("chromium_headless_shell-1199");
    expect(statusOf(["chromium"])["chromium"]).toMatchObject({ unavailable: expect.any(String) });
  });

  it("checks a system Chrome where Playwright looks for it, and trusts channels it cannot place", () => {
    const status = statusOf([local("chrome", { channel: "chrome-beta" })]);
    expect(status["chrome"]).toBe("ready");
    const chrome = verifyLocalTargets(
      flattenBrowsers(["chrome"]).locals,
      types(),
      (path) => path.includes("Google") || path.includes("google"),
    )[0]?.status;
    expect(chrome).toBe("ready");
    const missing = verifyLocalTargets(flattenBrowsers(["chrome"]).locals, types(), () => false)[0]
      ?.status;
    expect(missing).toEqual({ unavailable: expect.stringContaining("playwright install chrome") });
  });

  it("falls back to the executable alone when it sits outside a revision directory", async () => {
    const custom: BrowserTypes = {
      ...types(),
      firefox: { executablePath: () => join(root, "custom-firefox") },
    };
    expect(
      verifyLocalTargets(flattenBrowsers(["firefox"]).locals, custom)[0]?.status,
    ).toMatchObject({
      unavailable: expect.any(String),
    });
    await writeFile(join(root, "custom-firefox"), "");
    expect(verifyLocalTargets(flattenBrowsers(["firefox"]).locals, custom)[0]?.status).toBe(
      "ready",
    );
  });

  it("treats the new-headless `chromium` channel as the bundled engine", async () => {
    await install("chromium_headless_shell-1200");
    expect(statusOf([local("chromium", { channel: "chromium" })])["chromium"]).toBe("ready");
  });
});
