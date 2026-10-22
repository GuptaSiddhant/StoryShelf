import {
  TargetLaunchError,
  type StoryEntry,
  type Viewport,
} from "@storyshelf/core/adapter/capture-runner";
import { maxPageConcurrency, recommendedPageConcurrency } from "@storyshelf/core/utils";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeRuns } from "./browser.ts";
import {
  createPlaywrightCaptureRunner,
  createRuntimeParamsState,
  runtimeParametersForStory,
} from "./capture-runner.ts";
import { local } from "./targets.ts";

const playwright = vi.hoisted(() => {
  let closed = false;
  let launches = 0;
  const pendingGotos: ((error: Error) => void)[] = [];
  let lastBrowser: typeof browser | null = null;
  let hangNextGoto = true;
  let extractResult: unknown;
  const launchOptions: unknown[] = [];
  let launchFailure: Error | null = null;
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
    setViewportSize: async (): Promise<void> => {
      await Promise.resolve();
    },
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
  const stats = { contextsOpened: 0, contextsClosed: 0, pagesOpened: 0 };
  const browser = {
    closed: false,
    version: (): string => "124.0.6367.29",
    newContext: async (): Promise<unknown> => {
      await Promise.resolve();
      stats.contextsOpened += 1;
      return {
        newPage: async (): Promise<ReturnType<typeof makePage>> => {
          await Promise.resolve();
          stats.pagesOpened += 1;
          return makePage();
        },
        clearCookies: async (): Promise<void> => {
          await Promise.resolve();
        },
        close: async (): Promise<void> => {
          await Promise.resolve();
          stats.contextsClosed += 1;
        },
      };
    },
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
      launch: async (options?: unknown): Promise<typeof browser> => {
        launchOptions.push(options);
        if (launchFailure !== null) {
          throw launchFailure;
        }
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
    hangingPages: (): number => pendingGotos.length,
    launchOptions,
    failLaunches: (error: Error | null): void => {
      launchFailure = error;
    },
    stats,
    configureHang: (hang: boolean): void => {
      hangNextGoto = hang;
    },
    setExtractResult: (map: unknown): void => {
      extractResult = map;
    },
  };
});

vi.mock("playwright-core", () => ({
  chromium: {
    ...playwright.chromium,
    executablePath: () => "/nowhere/chromium-1/chrome-linux/chrome",
  },
  firefox: { ...playwright.chromium, executablePath: () => "/nowhere/firefox-1/firefox/firefox" },
  webkit: { ...playwright.chromium, executablePath: () => "/nowhere/webkit-1/pw_run.sh" },
}));

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

    // Cancel once a page is stuck in `goto`, however long a loaded host takes to get there.
    await vi.waitFor(() => {
      expect(playwright.hangingPages()).toBeGreaterThan(0);
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

  it("reuses pages across captures when reusePages is on", async () => {
    const stories = Array.from({ length: 8 }, (_, i) => ({ ...STORIES[0]!, id: `s-${i}` }));
    const before = { ...playwright.stats };
    playwright.configureHang(false);
    const result = await createPlaywrightCaptureRunner({ concurrency: 2, reusePages: true }).render(
      {
        buildId: "build-1",
        storybookDir,
        stories,
        viewports: VIEWPORTS,
      },
    );

    expect(result.captures).toHaveLength(8);
    // 8 captures through 2 slots: two pages are opened once and reused, then closed.
    expect(playwright.stats.pagesOpened - before.pagesOpened).toBeLessThanOrEqual(2);
    expect(playwright.stats.contextsClosed - before.contextsClosed).toBe(
      playwright.stats.contextsOpened - before.contextsOpened,
    );
  }, 30_000);

  it("streams captures to onCapture instead of collecting them", async () => {
    const seen: string[] = [];
    playwright.configureHang(false);
    const result = await createPlaywrightCaptureRunner().render({
      buildId: "build-1",
      storybookDir,
      stories: STORIES,
      viewports: VIEWPORTS,
      onCapture: async (capture) => {
        await Promise.resolve();
        seen.push(`${capture.story.id}/${capture.viewportName}`);
      },
    });

    expect(seen).toEqual(["components-button--primary/desktop"]);
    expect(result.captures).toHaveLength(0);
  }, 30_000);

  it("reports a failed onCapture as a render failure for that story", async () => {
    playwright.configureHang(false);
    const result = await createPlaywrightCaptureRunner().render({
      buildId: "build-1",
      storybookDir,
      stories: STORIES,
      viewports: VIEWPORTS,
      onCapture: async () => {
        await Promise.resolve();
        throw new Error("disk full");
      },
    });

    expect(result.failures.map((f) => f.error)).toEqual(["disk full"]);
  }, 30_000);

  it("cancels one render of a build by its run id, leaving a concurrent sibling running", async () => {
    const runner = createPlaywrightCaptureRunner();
    playwright.configureHang(true);
    const render = (runId: string) =>
      runner.render({
        buildId: "build-1",
        runId,
        storybookDir,
        stories: STORIES,
        viewports: VIEWPORTS,
      });
    const first = render("shard-a");
    const second = render("shard-b");
    await vi.waitFor(() => {
      expect(activeRuns.matching("build-1").every((run) => run.browser !== null)).toBe(true);
      expect(activeRuns.matching("build-1")).toHaveLength(2);
    });
    const [a] = activeRuns.matching("build-1", "shard-a");
    const [b] = activeRuns.matching("build-1", "shard-b");

    await runner.cancel("build-1", "shard-a");

    expect(a?.cancelled).toBe(true);
    expect(b?.cancelled).toBe(false);
    await runner.cancel("build-1");
    expect(b?.cancelled).toBe(true);
    await Promise.all([first, second]);
    expect(activeRuns.matching("build-1")).toEqual([]);
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

  it("adapts page concurrency when none is configured, never above the ceiling", async () => {
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
          setTimeout(resolve, 2);
        });
        active -= 1;
      },
    };
    const stories = Array.from({ length: 60 }, (_, i) => ({ ...STORIES[0]!, id: `s-${i}` }));
    playwright.configureHang(false);
    const result = await createPlaywrightCaptureRunner({}).render({
      buildId: "build-1",
      storybookDir,
      stories,
      viewports: VIEWPORTS,
      adapter,
    });

    expect(result.captures).toHaveLength(60);
    expect(peak).toBeGreaterThanOrEqual(1);
    expect(peak).toBeLessThanOrEqual(maxPageConcurrency());
  }, 30_000);

  it("reports the browser build and host platform as the capture environment", async () => {
    playwright.configureHang(false);
    const result = await createPlaywrightCaptureRunner({}).render({
      buildId: "build-1",
      storybookDir,
      stories: STORIES,
      viewports: VIEWPORTS,
    });
    expect(result.environment).toMatchObject({
      browserVersion: "124.0.6367.29",
      platform: `${process.platform}-${process.arch}`,
      deviceScaleFactor: 1,
    });
  }, 30_000);

  it("sizes the page budget by engine in the sizing log", async () => {
    const info = vi.fn();
    playwright.configureHang(false);
    const logger = { info, debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
    await createPlaywrightCaptureRunner({ browsers: ["chromium", "firefox"] }).render({
      buildId: "build-1",
      storybookDir,
      stories: STORIES,
      viewports: VIEWPORTS,
      target: "firefox",
      logger,
    });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ pages: recommendedPageConcurrency(undefined, "firefox") }),
      "capture sizing",
    );
  }, 30_000);

  it("echoes the target on every row it produces", async () => {
    playwright.configureHang(false);
    const result = await createPlaywrightCaptureRunner({
      browsers: ["chromium", "firefox"],
    }).render({
      buildId: "build-1",
      storybookDir,
      stories: STORIES,
      viewports: VIEWPORTS,
      target: "firefox",
    });
    expect(result.captures.map((capture) => capture.browser)).toEqual(["firefox"]);
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

const input = () => ({
  buildId: "build-1",
  storybookDir,
  stories: STORIES,
  viewports: VIEWPORTS,
});

describe("createPlaywrightCaptureRunner targets (ADR 0007)", () => {
  it("offers chromium only by default, ready, reaching the loopback server", () => {
    expect(createPlaywrightCaptureRunner().metadata.targets).toEqual([
      { target: "chromium", reach: "loopback", status: "ready" },
    ]);
  });

  it("lists every declared target, default first, and rejects bad lists when created", () => {
    const runner = createPlaywrightCaptureRunner({
      browsers: ["webkit", local("chrome"), "firefox"],
    });
    expect(runner.metadata.targets?.map((entry) => entry.target)).toEqual([
      "webkit",
      "chrome",
      "firefox",
    ]);
    expect(() => createPlaywrightCaptureRunner({ browsers: [] })).toThrow(/at least one/u);
    expect(() => createPlaywrightCaptureRunner({ browsers: ["firefox", "firefox"] })).toThrow(
      /entries 1 and 2 both produce the target "firefox"/u,
    );
  });

  it("renders on the first target when the request names none", async () => {
    playwright.configureHang(false);
    const result = await createPlaywrightCaptureRunner({
      browsers: ["firefox", "chromium"],
    }).render(input());
    expect(result.captures.map((capture) => capture.browser)).toEqual(["firefox"]);
  }, 30_000);

  it("launches bare chrome with the chrome channel, bundled chromium with none", async () => {
    playwright.configureHang(false);
    const runner = createPlaywrightCaptureRunner({ browsers: ["chromium", "chrome"] });
    const before = playwright.launchOptions.length;
    await runner.render({ ...input(), target: "chrome" });
    await runner.render({ ...input(), target: "chromium" });
    const [chrome, chromium] = playwright.launchOptions.slice(before) as {
      channel?: string;
      args: string[];
    }[];
    expect(chrome?.channel).toBe("chrome");
    expect(chromium).not.toHaveProperty("channel");
    expect(chromium?.args).toContain("--disable-dev-shm-usage");
  }, 30_000);

  it("passes a local() channel through", async () => {
    playwright.configureHang(false);
    const runner = createPlaywrightCaptureRunner({
      browsers: [local("chrome", { channel: "chrome-beta" })],
    });
    const before = playwright.launchOptions.length;
    await runner.render(input());
    expect((playwright.launchOptions[before] as { channel?: string }).channel).toBe("chrome-beta");
  }, 30_000);

  it("fails a render for a target it does not offer", async () => {
    const runner = createPlaywrightCaptureRunner();
    await expect(runner.render({ ...input(), target: "firefox" })).rejects.toThrow(
      /Cannot launch firefox: not offered by this runner/u,
    );
    await expect(runner.render({ ...input(), target: "chromium@grid" })).rejects.toBeInstanceOf(
      TargetLaunchError,
    );
  });

  it("fails at once when the browser will not launch, and marks the target unavailable", async () => {
    const runner = createPlaywrightCaptureRunner({ browsers: ["chromium", "firefox"] });
    playwright.failLaunches(
      new Error("Executable doesn't exist at /x/firefox\nrun playwright install"),
    );
    try {
      await expect(runner.render({ ...input(), target: "firefox" })).rejects.toThrow(
        new TargetLaunchError("firefox", "Executable doesn't exist at /x/firefox"),
      );
    } finally {
      playwright.failLaunches(null);
    }
    expect(runner.metadata.targets).toEqual([
      { target: "chromium", reach: "loopback", status: "ready" },
      {
        target: "firefox",
        reach: "loopback",
        status: { unavailable: "Executable doesn't exist at /x/firefox" },
      },
    ]);
  });

  it("verifies installed engines in setup and reports them in health", async () => {
    const runner = createPlaywrightCaptureRunner({ browsers: ["chromium", "firefox"] });
    await runner.lifecycle?.setup({} as never);
    const statuses = runner.metadata.targets?.map((entry) => entry.status);
    expect(statuses).toEqual([
      { unavailable: expect.stringContaining("declared, not installed") },
      { unavailable: expect.stringContaining("declared, not installed") },
    ]);
    const health = await runner.lifecycle?.health();
    expect(health?.ok).toBe(false);
    expect(health?.detail).toContain("firefox: declared, not installed");
    await expect(runner.lifecycle?.teardown()).resolves.toBeUndefined();
  });
});
