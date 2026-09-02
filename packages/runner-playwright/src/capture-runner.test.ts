import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoryEntry, Viewport } from "@storyshelf/core";

import { createPlaywrightCaptureRunner } from "./capture-runner.ts";

const playwright = vi.hoisted(() => {
  let closed = false;
  const pendingGotos: ((error: Error) => void)[] = [];
  let lastBrowser: typeof browser | null = null;
  const page = {
    goto: async (): Promise<void> => {
      if (closed) {
        throw new Error("Browser closed by cancel");
      }
      await new Promise<void>((_resolve, reject) => {
        pendingGotos.push(reject);
      });
    },
    waitForSelector: async (): Promise<unknown> => {
      await Promise.resolve();
      return null;
    },
    screenshot: async (): Promise<Buffer> => {
      await Promise.resolve();
      return Buffer.from([0]);
    },
    close: async (): Promise<void> => {
      await Promise.resolve();
    },
  };
  const browser = {
    closed: false,
    newPage: async (): Promise<typeof page> => {
      await Promise.resolve();
      return page;
    },
    close: async (): Promise<void> => {
      browser.closed = true;
      closed = true;
      for (const reject of pendingGotos.splice(0)) {
        reject(new Error("Browser closed by cancel"));
      }
      await Promise.resolve();
    },
  };
  return {
    browser,
    chromium: {
      launch: async (): Promise<typeof browser> => {
        closed = false;
        browser.closed = false;
        lastBrowser = browser;
        await Promise.resolve();
        return browser;
      },
    },
    lastBrowser: (): typeof browser | null => lastBrowser,
  };
});

vi.mock("playwright", () => ({ chromium: playwright.chromium }));

const STORIES: StoryEntry[] = [
  {
    id: "components-button--primary",
    title: "Components/Button",
    name: "Primary",
    importPath: "./Button.stories.tsx",
    type: "story",
  },
];

const VIEWPORTS: Viewport[] = [{ name: "desktop", width: 1280, height: 720 }];

let tmp = "";
let storybookDir = "";

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "storyshelf-render-"));
  storybookDir = join(tmp, "storybook");
  await mkdir(storybookDir, { recursive: true });
  await writeFile(join(storybookDir, "index.html"), "<html><body>fixture</body></html>");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("createPlaywrightCaptureRunner.render", () => {
  it("reports a story as failed when the in-flight browser is cancelled", async () => {
    const runner = createPlaywrightCaptureRunner();
    const renderPromise = runner.render({ buildId: "build-1", storybookDir, stories: STORIES, viewports: VIEWPORTS });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    await expect(runner.cancel("build-1")).resolves.toBeUndefined();
    const result = await renderPromise;

    expect(result.captures).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.storyId).toBe("components-button--primary");
    const browser = playwright.lastBrowser();
    expect(browser?.closed).toBe(true);
  }, 30_000);

  it("resolves cancel for builds that are not rendering", async () => {
    const runner = createPlaywrightCaptureRunner();
    await expect(runner.cancel("does-not-exist")).resolves.toBeUndefined();
  });
});
