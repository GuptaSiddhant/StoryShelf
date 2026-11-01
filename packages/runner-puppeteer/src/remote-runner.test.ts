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
    probeError: null as Error | null,
    active: 0,
    peak: 0,
    closes: 0,
    disconnects: 0,
    pagesOpened: 0,
    pagesClosed: 0,
    contextsOpened: 0,
    contextsClosed: 0,
    hang: null as Promise<unknown> | null,
    holdConnect: null as { after: number; promise: Promise<unknown> } | null,
  };
  const makePage = () => {
    const page = {
      closed: false,
      goto: async (url: string): Promise<void> => {
        state.gotos.push(url);
        state.active += 1;
        state.peak = Math.max(state.peak, state.active);
        if (state.hang !== null) await state.hang;
        await new Promise((resolve) => setTimeout(resolve, 5));
        state.active -= 1;
        if (page.closed) throw new Error("page closed by cancel");
      },
      setDefaultTimeout: (): void => {},
      evaluateOnNewDocument: async (): Promise<void> => {
        await Promise.resolve();
      },
      setViewport: async (): Promise<void> => {
        await Promise.resolve();
      },
      waitForSelector: async (): Promise<unknown> => await Promise.resolve(null),
      evaluate: async (fn: unknown): Promise<unknown> => {
        await Promise.resolve();
        if (page.closed) throw new Error("page closed by cancel");
        if (typeof fn === "function" && fn.name === "inPageWaitSettled") {
          return { settled: true, hooked: true, phase: "completed", elapsedMs: 0 };
        }
        if (state.probeError !== null) throw state.probeError;
        return typeof fn === "function" && fn.name === "inPageProbe" ? state.probe : {};
      },
      $: async (): Promise<null> => await Promise.resolve(null),
      screenshot: async (): Promise<Buffer> => {
        if (page.closed) throw new Error("page closed by cancel");
        return await Promise.resolve(Buffer.from([0]));
      },
      close: async (): Promise<void> => {
        if (!page.closed) {
          page.closed = true;
          state.pagesClosed += 1;
        }
        await Promise.resolve();
      },
    };
    return page;
  };
  const browser = () => ({
    version: async (): Promise<string> => await Promise.resolve("HeadlessChrome/131.0.1"),
    newPage: async () => {
      state.pagesOpened += 1;
      return await Promise.resolve(makePage());
    },
    createBrowserContext: async () => {
      state.contextsOpened += 1;
      let closed = false;
      return await Promise.resolve({
        newPage: async () => {
          state.pagesOpened += 1;
          return await Promise.resolve(makePage());
        },
        close: async () => {
          if (!closed) {
            closed = true;
            state.contextsClosed += 1;
          }
          await Promise.resolve();
        },
      });
    },
    close: async (): Promise<void> => {
      state.closes += 1;
      await Promise.resolve();
    },
    disconnect: async (): Promise<void> => {
      state.disconnects += 1;
      await Promise.resolve();
    },
  });
  return {
    state,
    connect: async (options: Record<string, unknown>) => {
      state.connects.push(options);
      if (state.holdConnect !== null && state.connects.length > state.holdConnect.after) {
        await state.holdConnect.promise;
      }
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
const URL_BASE = "https://app.example/_s/tok/projects/p/storybook/build/b";
const URL_ROOT = `${URL_BASE}/`;

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
    probeError: null,
    active: 0,
    peak: 0,
    closes: 0,
    disconnects: 0,
    pagesOpened: 0,
    pagesClosed: 0,
    contextsOpened: 0,
    contextsClosed: 0,
    hang: null,
    holdConnect: null,
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
      input({ storybookUrl: URL_ROOT }),
    );
    expect(fake.state.connects[0]).toMatchObject({
      browserWSEndpoint: "wss://farm.example/?token=sekret-key",
      headers: { authorization: "Bearer sekret-token" },
    });
    expect(fake.state.gotos[0]?.startsWith(`${URL_BASE}/iframe.html?`)).toBe(true);
    expect(fake.state.gotos.some((url) => url.includes("127.0.0.1"))).toBe(false);
    expect(result.captures.map((capture) => capture.browser)).toEqual([
      "chromium@farm",
      "chromium@farm",
    ]);
    expect(fake.state.closes).toBe(0);
    expect(fake.state.disconnects).toBe(1);
  });

  it("refuses a Storybook URL that is not the directory root, before any connection", async () => {
    const runner = createPuppeteerCaptureRunner({ browsers: [farm()] });
    await expect(runner.render(input({ storybookUrl: `${URL_BASE}/iframe.html` }))).rejects.toThrow(
      /directory root/u,
    );
    expect(fake.state.connects).toEqual([]);
  });

  it("looks a Chrome with remote debugging up by its HTTP address", async () => {
    await createPuppeteerCaptureRunner({
      browsers: [farm({ endpoint: "http://chrome:9222" })],
    }).render(input({ storybookUrl: URL_ROOT }));
    expect(fake.state.connects[0]).toMatchObject({ browserURL: "http://chrome:9222" });
    expect(fake.state.connects[0]).not.toHaveProperty("browserWSEndpoint");
  });

  it("reports the environment measured in the browser", async () => {
    const result = await createPuppeteerCaptureRunner({ browsers: [farm()] }).render(
      input({ storybookUrl: URL_ROOT }),
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
        async (buildId) => await runner.render(input({ buildId, stories, storybookUrl: URL_ROOT })),
      ),
    );
    expect(fake.state.peak).toBe(2);
  });

  it("fails at once when the service is down, keeping the target offered and the endpoint out of the message", async () => {
    const runner = createPuppeteerCaptureRunner({ browsers: [farm()] });
    fake.state.failure = new Error("connect ECONNREFUSED wss://farm.example/?token=sekret-key");
    const failure: unknown = await runner
      .render(input({ storybookUrl: URL_ROOT }))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TargetLaunchError);
    expect((failure as TargetLaunchError).transient).toBe(true);
    expect((failure as Error).message).not.toContain("sekret");
    // Retried with backoff before the render saw it (3 retries by default).
    expect(fake.state.connects).toHaveLength(4);
    expect(runner.metadata.targets?.[0]?.status).toBe("ready");
    expect(fake.state.closes).toBe(0);
    expect(fake.state.disconnects).toBe(0);
  }, 30_000);

  it("marks the target unavailable when the credentials are refused", async () => {
    const runner = createPuppeteerCaptureRunner({ browsers: [farm()] });
    fake.state.failure = new Error(
      "Unexpected server response: 401 for wss://farm.example/?token=sekret-key",
    );
    await expect(runner.render(input({ storybookUrl: URL_ROOT }))).rejects.toThrow(
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

  it("recycles at 150 captures without closing a shared connected browser", async () => {
    const stories = Array.from({ length: 151 }, (_, index) => ({
      ...STORIES[0]!,
      id: `s-${index}`,
    }));
    const runner = createPuppeteerCaptureRunner({
      browsers: [farm({ name: "shared", sessions: 2 })],
      concurrency: 8,
    });
    const [long, sibling] = await Promise.all([
      runner.render(input({ buildId: "long", stories, storybookUrl: URL_ROOT })),
      runner.render(input({ buildId: "sibling", stories: STORIES, storybookUrl: URL_ROOT })),
    ]);

    expect(long.failures).toEqual([]);
    expect(long.captures).toHaveLength(151);
    expect(sibling.failures).toEqual([]);
    expect(sibling.captures).toHaveLength(2);
    expect(fake.state.connects).toHaveLength(3);
    expect(fake.state.closes).toBe(0);
    expect(fake.state.disconnects).toBe(3);
    expect(fake.state.pagesOpened).toBe(fake.state.pagesClosed);
    expect(fake.state.peak).toBe(2);
  }, 30_000);

  it("keeps a connected browser open across teardown and disconnects when the run drains", async () => {
    const gate = Promise.withResolvers<boolean>();
    fake.state.hang = gate.promise;
    const runner = createPuppeteerCaptureRunner({ browsers: [farm()] });
    const rendering = runner.render(input({ storybookUrl: URL_ROOT }));

    await vi.waitFor(() => {
      expect(fake.state.gotos.length).toBeGreaterThan(0);
    });
    await runner.lifecycle?.teardown();
    expect(fake.state.disconnects).toBe(0);
    expect(fake.state.closes).toBe(0);

    gate.resolve(true);
    const result = await rendering;

    expect(result.failures).toEqual([]);
    expect(result.captures).toHaveLength(2);
    expect(fake.state.disconnects).toBe(1);
    expect(fake.state.closes).toBe(0);
  }, 30_000);

  it("cancels a connected run without closing the browser", async () => {
    const gate = Promise.withResolvers<boolean>();
    fake.state.hang = gate.promise;
    const runner = createPuppeteerCaptureRunner({
      browsers: [farm({ sessions: 2 })],
      concurrency: 2,
    });
    const rendering = runner.render(input({ storybookUrl: URL_ROOT }));

    await vi.waitFor(() => {
      expect(fake.state.gotos.length).toBe(2);
    });
    await runner.cancel("b1");
    gate.resolve(true);
    const result = await rendering;

    expect(result.captures).toHaveLength(0);
    expect(result.failures).toHaveLength(2);
    expect(fake.state.closes).toBe(0);
    expect(fake.state.disconnects).toBe(1);
  }, 30_000);

  it("disconnects a connected browser when measuring its environment fails", async () => {
    fake.state.probeError = new Error("probe failed");
    const result = await createPuppeteerCaptureRunner({ browsers: [farm()] }).render(
      input({ storybookUrl: URL_ROOT }),
    );

    expect(result.failures).toEqual([]);
    expect(result.captures).toHaveLength(2);
    expect(result.environment?.browserVersion).toBe("HeadlessChrome/131.0.1");
    expect(fake.state.closes).toBe(0);
    expect(fake.state.disconnects).toBe(1);
  });

  it("releases a connection acquired while the run is cancelled", async () => {
    const gate = Promise.withResolvers<boolean>();
    fake.state.holdConnect = { after: 1, promise: gate.promise };
    const runner = createPuppeteerCaptureRunner({
      browsers: [farm()],
      recycleBrowserEvery: 1,
    });
    const rendering = runner.render(input({ storybookUrl: URL_ROOT }));

    await vi.waitFor(() => {
      expect(fake.state.connects).toHaveLength(2);
    });
    await runner.cancel("b1");
    gate.resolve(true);

    await expect(rendering).rejects.toThrow("Capture cancelled");
    expect(fake.state.closes).toBe(0);
    expect(fake.state.disconnects).toBe(2);
  }, 30_000);
});
