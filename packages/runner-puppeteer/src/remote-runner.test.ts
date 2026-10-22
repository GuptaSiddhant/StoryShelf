import { TargetLaunchError, type StoryEntry } from "@storyshelf/core/adapter/capture-runner";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPuppeteerCaptureRunner } from "./capture-runner.ts";
import { cdp } from "./remote/cdp.ts";

const fake = vi.hoisted(() => {
  const state = {
    connects: [] as Record<string, unknown>[],
    gotos: [] as string[],
    failure: null as Error | null,
    probe: undefined as unknown,
    active: 0,
    peak: 0,
  };
  const page = {
    goto: async (url: string): Promise<void> => {
      state.gotos.push(url);
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.active -= 1;
    },
    setDefaultTimeout: (): void => {},
    setViewport: async (): Promise<void> => {
      await Promise.resolve();
    },
    waitForSelector: async (): Promise<unknown> => await Promise.resolve(null),
    evaluate: async (fn: unknown): Promise<unknown> => {
      await Promise.resolve();
      return typeof fn === "function" && fn.name === "inPageProbe" ? state.probe : {};
    },
    $: async (): Promise<null> => await Promise.resolve(null),
    screenshot: async (): Promise<Buffer> => await Promise.resolve(Buffer.from([0])),
    close: async (): Promise<void> => {
      await Promise.resolve();
    },
  };
  const browser = () => ({
    version: async (): Promise<string> => await Promise.resolve("HeadlessChrome/131.0.1"),
    newPage: async () => await Promise.resolve(page),
    createBrowserContext: async () =>
      await Promise.resolve({ newPage: async () => page, close: async () => {} }),
    close: async (): Promise<void> => {
      await Promise.resolve();
    },
  });
  return {
    state,
    connect: async (options: Record<string, unknown>) => {
      state.connects.push(options);
      if (state.failure !== null) throw state.failure;
      return browser();
    },
  };
});

vi.mock("puppeteer-core", () => ({
  default: { connect: fake.connect, launch: async () => ({}) },
}));

const STORIES: StoryEntry[] = [
  { id: "a--one", title: "A", name: "One", type: "story" },
  { id: "a--two", title: "A", name: "Two", type: "story" },
];
const VIEWPORTS = [{ name: "desktop", width: 1280, height: 720 }];
const URL_BASE = "https://app.example/s/tok/projects/p/storybook/build/b";

let storybookDir = "";
let tmp = "";

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "storyshelf-remote-"));
  storybookDir = join(tmp, "storybook");
  await mkdir(storybookDir, { recursive: true });
  await writeFile(join(storybookDir, "index.html"), "<html></html>");
  Object.assign(fake.state, {
    connects: [],
    gotos: [],
    failure: null,
    probe: { platform: "Linux x86_64", deviceScaleFactor: 1, fonts: ["Arial"] },
    active: 0,
    peak: 0,
  });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const farm = (overrides: Partial<Parameters<typeof cdp>[0]> = {}) =>
  cdp({
    name: "farm",
    endpoint: "wss://farm.example/?token=sekret-key",
    headers: { authorization: "Bearer sekret-token" },
    sessions: 2,
    platform: "windows",
    ...overrides,
  });

const input = (extra: Record<string, unknown> = {}) => ({
  buildId: "b1",
  storybookDir,
  stories: STORIES,
  viewports: VIEWPORTS,
  ...extra,
});

describe("a remote CDP target", () => {
  it("is offered as needing a URL, and refuses to start without one", async () => {
    const runner = createPuppeteerCaptureRunner({ browsers: [farm()] });
    expect(runner.metadata.targets).toEqual([
      { target: "chromium@farm", reach: "url", status: "ready" },
    ]);
    await expect(runner.render(input())).rejects.toBeInstanceOf(TargetLaunchError);
    expect(fake.state.connects).toEqual([]);
  });

  it("connects with the headers and renders from the URL it was given, not the loopback server", async () => {
    const result = await createPuppeteerCaptureRunner({ browsers: [farm()] }).render(
      input({ storybookUrl: `${URL_BASE}/iframe.html` }),
    );
    expect(fake.state.connects[0]).toMatchObject({
      browserWSEndpoint: "wss://farm.example/?token=sekret-key",
      headers: { authorization: "Bearer sekret-token" },
    });
    expect(fake.state.gotos[0]).toMatch(
      new RegExp(`^${URL_BASE.replaceAll(".", "\\.")}/iframe\\.html\\?`, "u"),
    );
    expect(fake.state.gotos.some((url) => url.includes("127.0.0.1"))).toBe(false);
    expect(result.captures.map((capture) => capture.browser)).toEqual([
      "chromium@farm",
      "chromium@farm",
    ]);
  });

  it("looks a Chrome with remote debugging up by its HTTP address", async () => {
    await createPuppeteerCaptureRunner({
      browsers: [farm({ endpoint: "http://chrome:9222" })],
    }).render(input({ storybookUrl: URL_BASE }));
    expect(fake.state.connects[0]).toMatchObject({ browserURL: "http://chrome:9222" });
    expect(fake.state.connects[0]).not.toHaveProperty("browserWSEndpoint");
  });

  it("reports the environment measured in the browser", async () => {
    const result = await createPuppeteerCaptureRunner({ browsers: [farm()] }).render(
      input({ storybookUrl: URL_BASE }),
    );
    expect(result.environment).toEqual({
      browserVersion: "HeadlessChrome/131.0.1",
      platform: "linux",
      deviceScaleFactor: 1,
      fontsHash: expect.stringMatching(/^[0-9a-f]{16}$/u),
    });
  });

  it("holds concurrent renders of the target to its sessions", async () => {
    const runner = createPuppeteerCaptureRunner({
      browsers: [farm({ name: "shared", sessions: 2 })],
      concurrency: 8,
    });
    const stories = Array.from({ length: 6 }, (_, index) => ({ ...STORIES[0]!, id: `s-${index}` }));
    await Promise.all(
      ["x", "y", "z"].map(
        async (buildId) => await runner.render(input({ buildId, stories, storybookUrl: URL_BASE })),
      ),
    );
    expect(fake.state.peak).toBe(2);
  });

  it("fails at once when the service is down, keeping the target offered and the endpoint out of the message", async () => {
    const runner = createPuppeteerCaptureRunner({ browsers: [farm()] });
    fake.state.failure = new Error("connect ECONNREFUSED wss://farm.example/?token=sekret-key");
    const error: unknown = await runner
      .render(input({ storybookUrl: URL_BASE }))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TargetLaunchError);
    expect((error as TargetLaunchError).transient).toBe(true);
    expect((error as Error).message).not.toContain("sekret");
    // Retried with backoff before the render saw it (3 retries by default).
    expect(fake.state.connects).toHaveLength(4);
    expect(runner.metadata.targets?.[0]?.status).toBe("ready");
  }, 30_000);

  it("marks the target unavailable when the credentials are refused", async () => {
    const runner = createPuppeteerCaptureRunner({ browsers: [farm()] });
    fake.state.failure = new Error(
      "Unexpected server response: 401 for wss://farm.example/?token=sekret-key",
    );
    await expect(runner.render(input({ storybookUrl: URL_BASE }))).rejects.toThrow(
      /Cannot launch chromium@farm: Unexpected server response: 401 for \[redacted\]/u,
    );
    expect(fake.state.connects).toHaveLength(1);
    expect(runner.metadata.targets?.[0]?.status).toEqual({
      unavailable: "Unexpected server response: 401 for [redacted]",
    });
  });

  it("is not probed when local targets are verified in setup", async () => {
    const runner = createPuppeteerCaptureRunner({
      browsers: [farm()],
    });
    await runner.lifecycle?.setup({} as never);
    expect(fake.state.connects).toEqual([]);
    expect(runner.metadata.targets?.[0]?.status).toBe("ready");
  });
});
