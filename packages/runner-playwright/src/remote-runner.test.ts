import {
  TargetLaunchError,
  type RemoteConnectContext,
  type StoryEntry,
} from "@storyshelf/core/adapter/capture-runner";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaywrightCaptureRunner } from "./capture-runner.ts";
import { remote } from "./remote/remote.ts";

const fake = vi.hoisted(() => {
  const state = {
    connects: [] as { kind: string; endpoint: string; options: Record<string, unknown> }[],
    gotos: [] as string[],
    failure: null as Error | null,
    probe: undefined as unknown,
    probeFails: false,
    active: 0,
    peak: 0,
    closed: 0,
    gate: null as Promise<void> | null,
  };
  const page = {
    goto: async (url: string): Promise<void> => {
      state.gotos.push(url);
      await state.gate;
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.active -= 1;
    },
    setDefaultTimeout: (): void => {},
    addInitScript: async (): Promise<void> => {
      await Promise.resolve();
    },
    setViewportSize: async (): Promise<void> => {
      await Promise.resolve();
    },
    waitForSelector: async (): Promise<unknown> => await Promise.resolve(null),
    waitForTimeout: async (): Promise<void> => {
      await Promise.resolve();
    },
    evaluate: async (fn: unknown): Promise<unknown> => {
      await Promise.resolve();
      if (typeof fn === "function" && fn.name === "inPageProbe") {
        if (state.probeFails) throw new Error("page crashed");
        return state.probe;
      }
      return {};
    },
    locator: () => ({ boundingBox: async (): Promise<null> => await Promise.resolve(null) }),
    screenshot: async (): Promise<Buffer> => await Promise.resolve(Buffer.from([0])),
    close: async (): Promise<void> => {
      await Promise.resolve();
    },
  };
  const browser = () => ({
    version: (): string => "131.0.1",
    newPage: async () => await Promise.resolve(page),
    close: async (): Promise<void> => {
      state.closed += 1;
      await Promise.resolve();
    },
  });
  const connecting =
    (kind: string) => async (endpoint: string, options: Record<string, unknown>) => {
      state.connects.push({ kind, endpoint, options });
      if (state.failure !== null) throw state.failure;
      return browser();
    };
  const engine = (name: string) => ({
    launch: async () => browser(),
    connect: connecting(name),
    connectOverCDP: connecting(`${name}-cdp`),
    executablePath: () => "/nowhere/chromium-1/chrome-linux/chrome",
  });
  return { state, engine };
});

vi.mock("playwright-core", () => ({
  chromium: fake.engine("chromium"),
  firefox: fake.engine("firefox"),
  webkit: fake.engine("webkit"),
}));

const STORIES: StoryEntry[] = [
  { id: "a--one", title: "A", name: "One", type: "story" },
  { id: "a--two", title: "A", name: "Two", type: "story" },
];
const VIEWPORTS = [{ name: "desktop", width: 1280, height: 720 }];

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
    probe: { platform: "Linux x86_64", deviceScaleFactor: 2, fonts: ["Arial", "Roboto"] },
    probeFails: false,
    active: 0,
    peak: 0,
    closed: 0,
    gate: null,
  });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Park every page navigation until `open()`, so a render stays in flight. */
function holdRenders(): { open: () => void } {
  const { promise, resolve } = Promise.withResolvers<null>();
  fake.state.gate = promise.then(() => {});
  return { open: () => resolve(null) };
}

const farm = (overrides: Partial<Parameters<typeof remote>[0]> = {}) =>
  remote({
    name: "grid",
    engines: ["chromium", "firefox"],
    sessions: 2,
    retry: { backoffMs: 1 },
    platform: "windows",
    protocol: "playwright",
    reach: "loopback",
    connect: {
      endpoint: "wss://farm.example/?key=sekret-key",
      headers: { authorization: "Bearer sekret-token" },
    },
    ...overrides,
  });

const input = (extra: Record<string, unknown> = {}) => ({
  buildId: "b1",
  storybookDir,
  stories: STORIES,
  viewports: VIEWPORTS,
  ...extra,
});

describe("a remote target", () => {
  it("connects with the headers and exposeNetwork, per engine, and renders over loopback", async () => {
    const runner = createPlaywrightCaptureRunner({ browsers: [farm()] });
    const result = await runner.render(input({ target: "firefox@grid" }));
    expect(fake.state.connects).toEqual([
      {
        kind: "firefox",
        endpoint: "wss://farm.example/?key=sekret-key",
        options: expect.objectContaining({
          headers: { authorization: "Bearer sekret-token" },
          exposeNetwork: "<loopback>",
        }),
      },
    ]);
    expect(result.captures.map((capture) => capture.browser)).toEqual([
      "firefox@grid",
      "firefox@grid",
    ]);
    expect(fake.state.gotos[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/iframe\.html/u);
  });

  it("defaults to the first target, and lists the targets with how each is reached", () => {
    const runner = createPlaywrightCaptureRunner({ browsers: [farm()] });
    expect(runner.metadata.targets).toEqual([
      { target: "chromium@grid", reach: "loopback", status: "ready" },
      { target: "firefox@grid", reach: "loopback", status: "ready" },
    ]);
  });

  it("reports the environment measured in the browser, never the host's", async () => {
    const result = await createPlaywrightCaptureRunner({ browsers: [farm()] }).render(input());
    expect(result.environment).toEqual({
      browserVersion: "131.0.1",
      platform: "linux",
      deviceScaleFactor: 2,
      fontsHash: expect.stringMatching(/^[0-9a-f]{16}$/u),
    });
  });

  it("falls back to the configured OS when the page cannot be probed, and omits what it cannot know", async () => {
    fake.state.probeFails = true;
    const warn = vi.fn();
    const result = await createPlaywrightCaptureRunner({ browsers: [farm()] }).render(
      input({ logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } }),
    );
    expect(result.environment).toEqual({ browserVersion: "131.0.1", platform: "windows" });
    expect(warn).toHaveBeenCalledWith(
      { reason: "page crashed" },
      "could not measure the remote browser",
    );
  });

  it("connects over CDP when the service speaks only that, and then needs a URL", async () => {
    const runner = createPlaywrightCaptureRunner({
      browsers: [
        farm({
          name: "cdp",
          engines: ["chromium"],
          protocol: "cdp",
          reach: "url",
          connect: { endpoint: "wss://cdp.example/" },
        }),
      ],
    });
    expect(runner.metadata.targets?.[0]?.reach).toBe("url");
    await expect(runner.render(input())).rejects.toThrow(/needs a Storybook URL/u);
    expect(fake.state.connects).toEqual([]);

    const result = await runner.render(
      input({ storybookUrl: "https://app.example/_s/tok/build/b/" }),
    );
    expect(result.captures).toHaveLength(2);
    expect(fake.state.connects[0]).toMatchObject({ kind: "chromium-cdp" });
    expect(fake.state.gotos[0]).toMatch(
      /^https:\/\/app\.example\/_s\/tok\/build\/b\/iframe\.html\?/u,
    );
    // The URL is the way in; the host's loopback server was never bound for it.
    expect(fake.state.gotos.some((url) => url.includes("127.0.0.1"))).toBe(false);
  });

  it("refuses a Storybook URL that is not the directory root, before any connection", async () => {
    const runner = createPlaywrightCaptureRunner({ browsers: [farm()] });
    await expect(
      runner.render(input({ storybookUrl: "https://app.example/_s/tok/build/b/iframe.html" })),
    ).rejects.toThrow(/directory root/u);
    expect(fake.state.connects).toEqual([]);
  });

  it("reads parameters on a remote target as well", async () => {
    const runner = createPlaywrightCaptureRunner({ browsers: [farm()] });
    await runner.extractParameters?.({
      buildId: "b1",
      storybookDir,
      stories: STORIES,
      target: "chromium@grid",
    });
    expect(fake.state.connects).toHaveLength(1);
    await expect(
      createPlaywrightCaptureRunner({
        browsers: [
          farm({
            engines: ["chromium"],
            protocol: "cdp",
            reach: "url",
            connect: { endpoint: "wss://x/" },
          }),
        ],
      }).extractParameters?.({ buildId: "b1", storybookDir, stories: STORIES }),
    ).rejects.toThrow(/needs a Storybook URL/u);
  });

  it("opens a new session when the browser is recycled", async () => {
    const stories = Array.from({ length: 6 }, (_, index) => ({ ...STORIES[0]!, id: `s-${index}` }));
    await createPlaywrightCaptureRunner({ browsers: [farm()], recycleBrowserEvery: 2 }).render(
      input({ stories }),
    );
    expect(fake.state.connects).toHaveLength(3);
  });

  it("holds every render of the target to its sessions, however many run at once", async () => {
    const runner = createPlaywrightCaptureRunner({
      browsers: [farm({ name: "shared", sessions: 2 })],
      concurrency: 8,
    });
    const stories = Array.from({ length: 6 }, (_, index) => ({ ...STORIES[0]!, id: `s-${index}` }));
    await Promise.all([
      runner.render(input({ buildId: "x", stories })),
      runner.render(input({ buildId: "y", stories })),
      runner.render(input({ buildId: "z", stories })),
    ]);
    expect(fake.state.peak).toBe(2);
  });

  it("keeps a target offered when the service is down, but fails the job at once with no endpoint in the message", async () => {
    const runner = createPlaywrightCaptureRunner({
      browsers: [farm({ retry: { attempts: 1, backoffMs: 1 } })],
    });
    fake.state.failure = new Error("connect ECONNREFUSED wss://farm.example/?key=sekret-key");
    const error: unknown = await runner.render(input()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TargetLaunchError);
    expect((error as TargetLaunchError).transient).toBe(true);
    expect((error as Error).message).not.toContain("sekret");
    expect(String((error as Error).cause)).not.toContain("sekret");
    // Retried once before the render saw it, and the target is still ready.
    expect(fake.state.connects).toHaveLength(2);
    expect(runner.metadata.targets?.map((entry) => entry.status)).toEqual(["ready", "ready"]);
  });

  it("marks a target unavailable when its credentials are refused, and does not retry", async () => {
    const runner = createPlaywrightCaptureRunner({ browsers: [farm()] });
    fake.state.failure = new Error(
      "WebSocket error: wss://farm.example/?key=sekret-key 401 Unauthorized",
    );
    await expect(runner.render(input({ target: "firefox@grid" }))).rejects.toThrow(
      /Cannot launch firefox@grid: WebSocket error: \[redacted\] 401 Unauthorized/u,
    );
    expect(fake.state.connects).toHaveLength(1);
    expect(runner.metadata.targets).toEqual([
      { target: "chromium@grid", reach: "loopback", status: "ready" },
      {
        target: "firefox@grid",
        reach: "loopback",
        status: { unavailable: "WebSocket error: [redacted] 401 Unauthorized" },
      },
    ]);
  });

  it("does not probe a remote target when verifying local engines", async () => {
    const runner = createPlaywrightCaptureRunner({ browsers: ["chromium", farm()] });
    await runner.lifecycle?.setup({} as never);
    expect(fake.state.connects).toEqual([]);
    expect(runner.metadata.targets?.map((entry) => entry.target)).toEqual([
      "chromium",
      "chromium@grid",
      "firefox@grid",
    ]);
    expect(runner.metadata.targets?.slice(1).map((entry) => entry.status)).toEqual([
      "ready",
      "ready",
    ]);
  });
});

const leased = (overrides: Partial<Parameters<typeof remote<{ id: string }>>[0]> = {}) => {
  const seen: RemoteConnectContext[] = [];
  const released: { lease: unknown; outcome: string; error?: unknown }[] = [];
  let next = 0;
  const service = remote<{ id: string }>({
    name: "grid",
    engines: ["chromium", "firefox"],
    sessions: 2,
    retry: { attempts: 1, backoffMs: 1 },
    protocol: "playwright",
    reach: "loopback",
    connect: async (context) => {
      seen.push(context);
      next += 1;
      const id = next;
      await Promise.resolve();
      return {
        endpoint: `wss://farm-${id}.example/?key=sekret-${id}`,
        lease: { id: `lease-${id}` },
      };
    },
    release: (lease, info) => {
      released.push({ lease, ...info });
    },
    ...overrides,
  });
  return { service, seen, released };
};

describe("a remote target with a function connect and release", () => {
  it("connects per shard with its identity, to what it returned, and releases as finished", async () => {
    const { service, seen, released } = leased();
    const runner = createPlaywrightCaptureRunner({ browsers: [service] });
    await Promise.all(
      [1, 2].map(
        async (shardIndex) =>
          await runner.render(
            input({ shardIndex, runId: `s${shardIndex}`, target: "chromium@grid" }),
          ),
      ),
    );
    expect(
      seen.map((context) => context.shardIndex).toSorted((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual([1, 2]);
    expect(seen.map((context) => context.runId).toSorted()).toEqual(["s1", "s2"]);
    expect(
      seen.every(
        (context) =>
          context.buildId === "b1" &&
          context.engine === "chromium" &&
          context.purpose === "render" &&
          context.attempt === 1 &&
          !context.signal.aborted,
      ),
    ).toBe(true);
    expect(fake.state.connects.map((connect) => connect.endpoint).toSorted()).toEqual([
      "wss://farm-1.example/?key=sekret-1",
      "wss://farm-2.example/?key=sekret-2",
    ]);
    expect(released.map((entry) => entry.outcome)).toEqual(["finished", "finished"]);
    expect(new Set(released.map((entry) => JSON.stringify(entry.lease))).size).toBe(2);
  });

  it("tells an unsharded render apart: no shard index, the build id as its run", async () => {
    const { service, seen } = leased();
    await createPlaywrightCaptureRunner({ browsers: [service] }).render(
      input({ target: "chromium@grid" }),
    );
    expect(seen[0]?.shardIndex).toBeUndefined();
    expect(seen[0]?.runId).toBe("b1");
  });

  it("releases as failed when the handshake fails after connect returned, once", async () => {
    const { service, released } = leased();
    fake.state.failure = new Error("401 Unauthorized");
    await expect(
      createPlaywrightCaptureRunner({ browsers: [service] }).render(
        input({ target: "chromium@grid" }),
      ),
    ).rejects.toBeInstanceOf(TargetLaunchError);
    expect(released).toHaveLength(1);
    expect(released[0]?.outcome).toBe("failed");
  });

  it("releases as cancelled when the build is cancelled mid-render", async () => {
    const { service, released } = leased();
    const runner = createPlaywrightCaptureRunner({ browsers: [service] });
    const hold = holdRenders();
    const rendering = runner.render(input({ target: "chromium@grid", runId: "s1" }));
    await vi.waitFor(() => {
      expect(fake.state.gotos.length).toBeGreaterThan(0);
    });
    await runner.cancel("b1", "s1");
    hold.open();
    await rendering.catch(() => {});
    expect(released.map((entry) => entry.outcome)).toEqual(["cancelled"]);
  });

  it("aborts a connect still pending when the build is cancelled, and does not retry it", async () => {
    const aborted = vi.fn();
    const started = vi.fn();
    const { service, released } = leased({
      retry: { attempts: 3, backoffMs: 1 },
      connect: async ({ signal }) =>
        await new Promise((_, reject) => {
          started();
          signal.addEventListener("abort", () => {
            aborted();
            reject(new Error("aborted"));
          });
        }),
    });
    const runner = createPlaywrightCaptureRunner({ browsers: [service] });
    const rendering = runner.render(input({ target: "chromium@grid", runId: "s1" }));
    await vi.waitFor(() => {
      expect(started).toHaveBeenCalledTimes(1);
    });
    await runner.cancel("b1", "s1");
    await expect(rendering).rejects.toBeInstanceOf(TargetLaunchError);
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(released).toEqual([]);
  });

  it("fails the render with a clear reason, holding nothing, when connect throws", async () => {
    const { service, released } = leased({
      retry: { attempts: 1, backoffMs: 1 },
      connect: () => Promise.reject(new Error("wake failed")),
    });
    const runner = createPlaywrightCaptureRunner({ browsers: [service] });
    const error = (await runner
      .render(input({ target: "chromium@grid" }))
      .catch((caught: unknown) => caught)) as TargetLaunchError;
    expect(error).toBeInstanceOf(TargetLaunchError);
    expect(error.reason).toBe("acquire failed: wake failed");
    expect(error.transient).toBe(true);
    expect(fake.state.connects).toEqual([]);
    expect(released).toEqual([]);
  });

  it("releases leases still held when the runner shuts down", async () => {
    const { service, released } = leased();
    const runner = createPlaywrightCaptureRunner({ browsers: [service] });
    const hold = holdRenders();
    const rendering = runner.render(input({ target: "chromium@grid", runId: "s9" }));
    await vi.waitFor(() => {
      expect(fake.state.gotos.length).toBeGreaterThan(0);
    });
    await runner.lifecycle?.teardown();
    hold.open();
    await rendering.catch(() => {});
    expect(released.map((entry) => entry.outcome)).toEqual(["cancelled"]);
  });
});
