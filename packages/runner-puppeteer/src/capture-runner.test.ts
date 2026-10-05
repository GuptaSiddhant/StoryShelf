import type { StoryEntry, Viewport } from "@storyshelf/core/adapter/capture-runner";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPuppeteerCaptureRunner,
  createRuntimeParamsState,
  runtimeParametersForStory,
} from "./capture-runner.ts";

const puppeteer = vi.hoisted(() => {
  let closed = false;
  const pendingGotos: ((error: Error) => void)[] = [];
  let lastBrowser: typeof browser | null = null;
  let hangNextGoto = true;
  let extractResult: unknown;
  const makePage = () => ({
    goto: async (): Promise<void> => {
      if (closed) {
        throw new Error("Browser closed by cancel");
      }
      if (!hangNextGoto) {
        return;
      }
      await new Promise<void>((_resolve, reject) => {
        pendingGotos.push(reject);
      });
    },
    setViewport: async (): Promise<void> => {
      await Promise.resolve();
    },
    waitForSelector: async (): Promise<unknown> => {
      await Promise.resolve();
      return null;
    },
    evaluate: async (): Promise<unknown> => {
      await Promise.resolve();
      return extractResult;
    },
    $: async (): Promise<null> => {
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
  });
  const browser = {
    closed: false,
    newPage: async (): Promise<ReturnType<typeof makePage>> => {
      await Promise.resolve();
      return makePage();
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
    launch: async (): Promise<typeof browser> => {
      closed = false;
      browser.closed = false;
      lastBrowser = browser;
      await Promise.resolve();
      return browser;
    },
    lastBrowser: (): typeof browser | null => lastBrowser,
    configureHang: (hang: boolean): void => {
      hangNextGoto = hang;
    },
    setExtractResult: (map: unknown): void => {
      extractResult = map;
    },
  };
});

vi.mock("puppeteer-core", () => ({ default: { launch: puppeteer.launch } }));

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

describe("createPuppeteerCaptureRunner.render", () => {
  it("reports a story as failed when the in-flight browser is cancelled", async () => {
    const runner = createPuppeteerCaptureRunner();
    puppeteer.configureHang(true);
    const renderPromise = runner.render({
      buildId: "build-1",
      storybookDir,
      stories: STORIES,
      viewports: VIEWPORTS,
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    await expect(runner.cancel("build-1")).resolves.toBeUndefined();
    const result = await renderPromise;

    expect(result.captures).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.storyId).toBe("components-button--primary");
    const browser = puppeteer.lastBrowser();
    expect(browser?.closed).toBe(true);
  }, 30_000);

  it("resolves cancel for builds that are not rendering", async () => {
    const runner = createPuppeteerCaptureRunner();
    await expect(runner.cancel("does-not-exist")).resolves.toBeUndefined();
  });

  it("awaits the adapter's waitForReady hook after navigation", async () => {
    const waitForReady = vi.fn(async (): Promise<void> => {
      await Promise.resolve();
    });
    const adapter = {
      name: "fake",
      discover: async (): Promise<StoryEntry[]> => [],
      buildUrl: (): string => "/",
      waitForReady,
    };
    const runner = createPuppeteerCaptureRunner();
    puppeteer.configureHang(false);
    const result = await runner.render({
      buildId: "build-1",
      storybookDir,
      stories: STORIES,
      viewports: VIEWPORTS,
      adapter,
    });

    expect(result.captures).toHaveLength(1);
    expect(waitForReady).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("enriches parameters from the runtime preview once per run", async () => {
    const runtime = createRuntimeParamsState();
    let evaluateCalls = 0;
    const page = {
      evaluate: async (): Promise<unknown> => {
        evaluateCalls += 1;
        return {
          "components-button--primary": {
            parameters: { chromatic: { delay: 250 }, storyshelf: { diffThreshold: 0.2 } },
          },
        };
      },
    };
    const params = await runtimeParametersForStory(runtime, page, "components-button--primary");
    await runtimeParametersForStory(runtime, page, "components-button--primary");

    expect(params).toEqual({ delay: 250, diffThreshold: 0.2 });
    expect(evaluateCalls).toBe(1);
  });

  it("falls back to runtime parameters when the index carries none", async () => {
    puppeteer.setExtractResult({
      "components-button--primary": {
        parameters: { chromatic: { delay: 250 }, storyshelf: { diffThreshold: 0.2 } },
      },
    });
    const adapter = {
      name: "fake",
      discover: async (): Promise<StoryEntry[]> => [],
      buildUrl: (): string => "/",
    };
    const runner = createPuppeteerCaptureRunner();
    puppeteer.configureHang(false);
    const result = await runner.render({
      buildId: "build-1",
      storybookDir,
      stories: STORIES,
      viewports: VIEWPORTS,
      adapter,
    });

    expect(result.captures).toHaveLength(1);
    expect(result.captures[0]?.story.parameters).toEqual({ delay: 250, diffThreshold: 0.2 });
  }, 30_000);

  it("captures at the story's default viewport in addition to the global list", async () => {
    const story: StoryEntry = {
      id: "components-button--primary",
      title: "Components/Button",
      name: "Primary",
      type: "story",
      parameters: { viewport: { defaultViewport: "tablet" } },
    };
    const runner = createPuppeteerCaptureRunner();
    puppeteer.configureHang(false);
    const result = await runner.render({
      buildId: "build-1",
      storybookDir,
      stories: [story],
      viewports: VIEWPORTS,
    });

    expect(result.captures).toHaveLength(2);
    expect(result.captures.map((c) => c.viewportName)).toEqual(["desktop", "tablet"]);
    expect(result.captures[1]?.viewport).toEqual({ name: "tablet", width: 834, height: 1112 });
  }, 30_000);

  it("does not duplicate a story default that matches a global viewport name", async () => {
    const story: StoryEntry = {
      id: "components-button--primary",
      title: "Components/Button",
      name: "Primary",
      type: "story",
      parameters: { viewport: { defaultViewport: "desktop" } },
    };
    const runner = createPuppeteerCaptureRunner();
    puppeteer.configureHang(false);
    const result = await runner.render({
      buildId: "build-1",
      storybookDir,
      stories: [story],
      viewports: VIEWPORTS,
    });

    expect(result.captures).toHaveLength(1);
    expect(result.captures.map((c) => c.viewportName)).toEqual(["desktop"]);
  }, 30_000);
});
