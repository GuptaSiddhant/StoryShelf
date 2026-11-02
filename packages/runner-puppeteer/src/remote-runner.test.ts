import {
  RemoteConnectError,
  TargetLaunchError,
  type RemoteConnectContext,
  type StoryEntry,
} from "@storyshelf/core/adapter/capture-runner";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPuppeteerCaptureRunner } from "./capture-runner.ts";
import { cdp, type CdpFixedOptions, type CdpLeasedOptions } from "./remote/cdp.ts";

const fake = vi.hoisted(() => {
  const state = {
    connects: [] as Record<string, unknown>[],
    gotos: [] as string[],
    failure: null as Error | null,
    probe: undefined as unknown,
    probeError: null as Error | null,
    probeHang: false,
    probeStarted: 0,
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
        if (state.probeHang && typeof fn === "function" && fn.name === "inPageProbe") {
          state.probeStarted += 1;
          await new Promise<never>(() => {});
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
    probeHang: false,
    probeStarted: 0,
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

const farm = (overrides: Partial<CdpFixedOptions> = {}) =>
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
/** Park every page navigation until `open()`, so a render stays in flight. */
function holdRenders(): { open: () => void } {
  const { promise, resolve } = Promise.withResolvers<unknown>();
  fake.state.hang = promise;
  return { open: () => resolve(true) };
}

const leased = (overrides: Partial<CdpLeasedOptions<{ id: string }>> = {}) => {
  const seen: RemoteConnectContext[] = [];
  const released: { lease: unknown; outcome: string; error?: unknown }[] = [];
  let next = 0;
  const options: CdpLeasedOptions<{ id: string }> = {
    name: "pool",
    sessions: 2,
    retry: { attempts: 1, backoffMs: 1 },
    connect: async (context) => {
      seen.push(context);
      next += 1;
      const id = next;
      await Promise.resolve();
      return {
        endpoint: `wss://pool-${id}.example/?key=sekret-${id}`,
        lease: { id: `lease-${id}` },
      };
    },
    release: (lease, info) => {
      released.push({ lease, ...info });
    },
    ...overrides,
  };
  const service = cdp<{ id: string }>(options);
  return { service, seen, released };
};

describe("measuring a remote CDP browser", () => {
  it("stops waiting for a probe that hangs, warns, renders, and leaves the environment unknown", async () => {
    fake.state.probeHang = true;
    const warn = vi.fn();
    const { service, released } = leased({ timeouts: { probeMs: 20 } });
    const result = await createPuppeteerCaptureRunner({ browsers: [service] }).render(
      input({
        storybookUrl: URL_ROOT,
        logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
      }),
    );
    expect(fake.state.probeStarted).toBe(1);
    expect(result.captures).toHaveLength(2);
    expect(result.environment).toEqual({ browserVersion: "HeadlessChrome/131.0.1" });
    expect(warn).toHaveBeenCalledWith(
      { timeoutMs: 20 },
      "measuring the remote browser timed out; its environment is unknown",
    );
    expect(released.map((entry) => entry.outcome)).toEqual(["finished"]);
  });

  it("stops the run when cancelled during the probe, and releases as cancelled", async () => {
    fake.state.probeHang = true;
    const { service, released } = leased();
    const runner = createPuppeteerCaptureRunner({ browsers: [service] });
    const rendering = runner.render(input({ storybookUrl: URL_ROOT }));
    const outcome = rendering.then(
      () => "rendered",
      (error: unknown) => (error as Error).message,
    );
    await vi.waitFor(() => {
      expect(fake.state.probeStarted).toBe(1);
    });
    await runner.cancel("b1");
    expect(await outcome).toBe("Capture cancelled");
    expect(fake.state.gotos).toEqual([]);
    expect(released.map((entry) => entry.outcome)).toEqual(["cancelled"]);
  });
});

describe("a remote CDP target with a function connect and release", () => {
  it("connects per shard with its identity and releases as finished", async () => {
    const { service, seen, released } = leased();
    const runner = createPuppeteerCaptureRunner({ browsers: [service] });
    await Promise.all(
      [1, 2].map(
        async (shardIndex) =>
          await runner.render(
            input({ shardIndex, runId: `s${shardIndex}`, storybookUrl: URL_ROOT }),
          ),
      ),
    );
    expect(
      seen.map((context) => context.shardIndex).toSorted((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual([1, 2]);
    expect(seen.every((context) => context.purpose === "render" && context.buildId === "b1")).toBe(
      true,
    );
    expect(fake.state.connects).toHaveLength(2);
    expect(released.map((entry) => entry.outcome)).toEqual(["finished", "finished"]);
  });

  it("releases as failed when the handshake fails after connect returned", async () => {
    const { service, released } = leased();
    fake.state.failure = new Error("Unexpected server response: 401");
    await expect(
      createPuppeteerCaptureRunner({ browsers: [service] }).render(
        input({ storybookUrl: URL_ROOT }),
      ),
    ).rejects.toBeInstanceOf(TargetLaunchError);
    expect(released.map((entry) => entry.outcome)).toEqual(["failed"]);
  });

  it("releases as cancelled when the build is cancelled mid-render", async () => {
    const { service, released } = leased();
    const runner = createPuppeteerCaptureRunner({ browsers: [service] });
    const hold = holdRenders();
    const rendering = runner.render(input({ runId: "s1", storybookUrl: URL_ROOT }));
    await vi.waitFor(() => {
      expect(fake.state.gotos.length).toBeGreaterThan(0);
    });
    await runner.cancel("b1", "s1");
    hold.open();
    await rendering.catch(() => {});
    expect(released.map((entry) => entry.outcome)).toEqual(["cancelled"]);
  });

  it("aborts a connect still pending on cancel, and does not retry it", async () => {
    const aborted = vi.fn();
    const started = vi.fn();
    const { service } = leased({
      retry: { attempts: 3, backoffMs: 1 },
      connect: async ({ signal }: RemoteConnectContext) =>
        await new Promise((_, reject) => {
          started();
          signal.addEventListener("abort", () => {
            aborted();
            reject(new Error("aborted"));
          });
        }),
    });
    const runner = createPuppeteerCaptureRunner({ browsers: [service] });
    const rendering = runner.render(input({ runId: "s1", storybookUrl: URL_ROOT }));
    await vi.waitFor(() => {
      expect(started).toHaveBeenCalledTimes(1);
    });
    await runner.cancel("b1", "s1");
    await expect(rendering).rejects.toBeInstanceOf(TargetLaunchError);
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it("fails the job without marking the target unavailable for a job-scoped permanent error", async () => {
    const { service } = leased({
      connect: () =>
        Promise.reject(new RemoteConnectError("server gone", { transient: false, scope: "job" })),
    });
    const runner = createPuppeteerCaptureRunner({ browsers: [service] });
    await expect(runner.render(input({ storybookUrl: URL_ROOT }))).rejects.toThrow(/server gone/u);
    expect(runner.metadata.targets?.[0]?.status).toBe("ready");
  });

  describe("with maxConnections", () => {
    it("connects the second shard only after the first connection is released", async () => {
      const { service, seen, released } = leased({ maxConnections: 1 });
      const runner = createPuppeteerCaptureRunner({ browsers: [service] });
      const hold = holdRenders();
      const first = runner.render(input({ shardIndex: 1, runId: "s1", storybookUrl: URL_ROOT }));
      await vi.waitFor(() => {
        expect(fake.state.gotos.length).toBeGreaterThan(0);
      });
      const second = runner.render(input({ shardIndex: 2, runId: "s2", storybookUrl: URL_ROOT }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(seen.map((context) => context.shardIndex)).toEqual([1]);
      hold.open();
      await Promise.all([first, second]);
      expect(seen.map((context) => context.shardIndex)).toEqual([1, 2]);
      expect(released.map((entry) => entry.outcome)).toEqual(["finished", "finished"]);
    });

    it("ends a shard that is cancelled while waiting, without connecting for it or freeing the first one's slot", async () => {
      const { service, seen, released } = leased({ maxConnections: 1 });
      const runner = createPuppeteerCaptureRunner({ browsers: [service] });
      const hold = holdRenders();
      const first = runner.render(input({ shardIndex: 1, runId: "s1", storybookUrl: URL_ROOT }));
      await vi.waitFor(() => {
        expect(fake.state.gotos.length).toBeGreaterThan(0);
      });
      const waiting = runner.render(input({ shardIndex: 2, runId: "s2", storybookUrl: URL_ROOT }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      await runner.cancel("b1", "s2");
      await expect(waiting).rejects.toBeInstanceOf(TargetLaunchError);
      expect(seen.map((context) => context.shardIndex)).toEqual([1]);
      const third = runner.render(input({ shardIndex: 3, runId: "s3", storybookUrl: URL_ROOT }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(seen.map((context) => context.shardIndex)).toEqual([1]);
      hold.open();
      await Promise.all([first, third]);
      expect(seen.map((context) => context.shardIndex)).toEqual([1, 3]);
      expect(released.map((entry) => entry.outcome)).toEqual(["finished", "finished"]);
    });
  });

  it("releases leases still held when the runner shuts down", async () => {
    const { service, released } = leased();
    const runner = createPuppeteerCaptureRunner({ browsers: [service] });
    const hold = holdRenders();
    const rendering = runner.render(input({ runId: "s9", storybookUrl: URL_ROOT }));
    await vi.waitFor(() => {
      expect(fake.state.gotos.length).toBeGreaterThan(0);
    });
    await runner.lifecycle?.teardown();
    hold.open();
    await rendering.catch(() => {});
    expect(released.map((entry) => entry.outcome)).toEqual(["cancelled"]);
  });

  it("is still a URL target: loopback reach is not an option for CDP", () => {
    expect(leased().service.reach).toBe("url");
    expect(() => cdp({ name: "x", endpoint: "wss://x/", engines: ["firefox"] as never })).toThrow(
      /Chromium only|cannot drive/u,
    );
  });
});
