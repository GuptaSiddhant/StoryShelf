import type { StoryEntry, Viewport } from "@storyshelf/core/adapter/capture-runner";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlaywrightCaptureRunner,
  createRuntimeParamsState,
  runtimeParametersForStory,
} from "./capture-runner.ts";

const playwright = vi.hoisted(() => {
  let closed = false;
  let launches = 0;
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
    setDefaultTimeout: (): void => {},
    waitForSelector: async (): Promise<unknown> => {
      await Promise.resolve();
      return null;
    },
    waitForTimeout: async (): Promise<void> => {
      await Promise.resolve();
    },
    evaluate: async (): Promise<unknown> => {
      await Promise.resolve();
      return extractResult;
    },
    locator: (): { boundingBox: () => Promise<null> } => ({
      boundingBox: async (): Promise<null> => {
        await Promise.resolve();
        return null;
      },
    }),
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
    chromium: {
      launch: async (): Promise<typeof browser> => {
        launches += 1;
        closed = false;
        browser.closed = false;
        lastBrowser = browser;
        await Promise.resolve();
        return browser;
      },
    },
    lastBrowser: (): typeof browser | null => lastBrowser,
    launchCount: (): number => launches,
    configureHang: (hang: boolean): void => {
      hangNextGoto = hang;
    },
    setExtractResult: (map: unknown): void => {
      extractResult = map;
    },
  };
});

vi.mock("playwright-core", () => ({ chromium: playwright.chromium }));

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
    playwright.configureHang(true);
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
    const browser = playwright.lastBrowser();
    expect(browser?.closed).toBe(true);
  }, 30_000);

  it("restarts the browser every N captures and logs the sizing", async () => {
    const stories = Array.from({ length: 10 }, (_, i) => ({ ...STORIES[0]!, id: `s-${i}` }));
    const before = playwright.launchCount();
    const info = vi.fn();
    playwright.configureHang(false);
    const result = await createPlaywrightCaptureRunner({ recycleBrowserEvery: 4 }).render({
      buildId: "build-1",
      storybookDir,
      stories,
      viewports: VIEWPORTS,
      logger: { info, debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    expect(result.captures).toHaveLength(10);
    // 10 captures in batches of 4 -> 3 browsers (initial + 2 restarts).
    expect(playwright.launchCount() - before).toBe(3);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ recycleBrowserEvery: 4, pages: expect.any(Number) }),
      "capture sizing",
    );
  }, 30_000);

  it("never restarts the browser when recycling is disabled", async () => {
    const stories = Array.from({ length: 6 }, (_, i) => ({ ...STORIES[0]!, id: `s-${i}` }));
    const before = playwright.launchCount();
    playwright.configureHang(false);
    await createPlaywrightCaptureRunner({ recycleBrowserEvery: 0 }).render({
      buildId: "build-1",
      storybookDir,
      stories,
      viewports: VIEWPORTS,
    });

    expect(playwright.launchCount() - before).toBe(1);
  }, 30_000);

  it("resolves cancel for builds that are not rendering", async () => {
    const runner = createPlaywrightCaptureRunner();
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
    const runner = createPlaywrightCaptureRunner();
    playwright.configureHang(false);
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

  it("caps concurrently open pages at the configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const adapter = {
      name: "fake",
      discover: async (): Promise<StoryEntry[]> => [],
      buildUrl: (): string => "/",
      waitForReady: async (): Promise<void> => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
        active -= 1;
      },
    };
    const stories = Array.from({ length: 12 }, (_, i) => ({ ...STORIES[0]!, id: `s-${i}` }));
    playwright.configureHang(false);
    const result = await createPlaywrightCaptureRunner({ concurrency: 3 }).render({
      buildId: "build-1",
      storybookDir,
      stories,
      viewports: VIEWPORTS,
      adapter,
    });

    expect(result.captures).toHaveLength(12);
    expect(peak).toBe(3);
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
    playwright.setExtractResult({
      "components-button--primary": {
        parameters: { chromatic: { delay: 250 }, storyshelf: { diffThreshold: 0.2 } },
      },
    });
    const adapter = {
      name: "fake",
      discover: async (): Promise<StoryEntry[]> => [],
      buildUrl: (): string => "/",
    };
    const runner = createPlaywrightCaptureRunner();
    playwright.configureHang(false);
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
    const runner = createPlaywrightCaptureRunner();
    playwright.configureHang(false);
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
    const runner = createPlaywrightCaptureRunner();
    playwright.configureHang(false);
    const result = await runner.render({
      buildId: "build-1",
      storybookDir,
      stories: [story],
      viewports: VIEWPORTS,
    });

    expect(result.captures).toHaveLength(1);
    expect(result.captures.map((c) => c.viewportName)).toEqual(["desktop"]);
  }, 30_000);
  it("captures each mode with its globals and viewport", async () => {
    const story: StoryEntry = {
      id: "components-button--primary",
      title: "Components/Button",
      name: "Primary",
      type: "story",
      parameters: { modes: { Dark: { theme: "dark", viewport: 900 } } },
    };
    const urls: { id: string; globals?: Record<string, unknown> }[] = [];
    const adapter = {
      name: "fake",
      discover: async (): Promise<StoryEntry[]> => [],
      buildUrl: (_base: string, id: string, globals?: Record<string, unknown>): string => {
        urls.push({ id, ...(globals ? { globals } : {}) });
        return "/";
      },
    };
    const runner = createPlaywrightCaptureRunner();
    playwright.configureHang(false);
    const result = await runner.render({
      buildId: "build-1",
      storybookDir,
      stories: [story],
      viewports: VIEWPORTS,
      adapter,
    });

    expect(result.captures.map((c) => c.viewportName)).toEqual(["desktop", "dark"]);
    expect(result.captures[1]?.viewport).toEqual({
      name: "dark",
      width: 900,
      height: 720,
      globals: { theme: "dark" },
    });
    expect(urls).toEqual([{ id: story.id }, { id: story.id, globals: { theme: "dark" } }]);
  }, 30_000);

  it("extracts resolved parameters (including modes) in one pass", async () => {
    playwright.setExtractResult({
      "components-button--primary": {
        parameters: {
          chromatic: { modes: { Dark: { theme: "dark" } } },
          storyshelf: { modes: { Wide: { viewport: 1600 } }, delay: 5 },
        },
      },
    });
    playwright.configureHang(false);
    const runner = createPlaywrightCaptureRunner();
    const params = await runner.extractParameters?.({
      buildId: "build-1",
      storybookDir,
      stories: STORIES,
    });

    expect(params).toEqual({
      "components-button--primary": {
        delay: 5,
        modes: { Dark: { theme: "dark" }, Wide: { viewport: 1600 } },
      },
    });
    await expect(
      runner.extractParameters?.({ buildId: "build-1", storybookDir, stories: [] }),
    ).resolves.toEqual({});
  }, 30_000);
});
