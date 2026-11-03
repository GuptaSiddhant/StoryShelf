import { describe, expect, it, vi } from "vitest";
import {
  SECRET_HEADER,
  browsersFor,
  spriteBrowser,
  spriteFromEnv,
  type SpriteConfig,
} from "./sprite.ts";

const SECRET = "s3cret-s3cret-s3cret";
const TOKEN = "fly-token-xyz";
const config: SpriteConfig = {
  token: TOKEN,
  secret: SECRET,
  name: "storyshelf-browser",
  url: null,
};

const context = (signal = new AbortController().signal) => ({
  engine: "chromium" as const,
  buildId: "b1",
  runId: "b1",
  purpose: "render" as const,
  attempt: 1,
  signal,
});

const connect = async (service: ReturnType<typeof spriteBrowser>, signal?: AbortSignal) => {
  if (typeof service.connect !== "function") {
    throw new TypeError("expected a connect function");
  }
  return await service.connect(context(signal));
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** A fetch that answers the Sprites API, then `/healthz` with the given statuses in turn. */
const fakeFetch = (health: number[], apiBody: unknown) => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const queue = [...health];
  const impl = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (url.startsWith("https://api.sprites.dev/")) {
      return typeof apiBody === "number" ? json({}, apiBody) : json(apiBody);
    }
    return new Response("", { status: queue.shift() ?? 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
};

const DEFAULT_API = { url: "https://demo-1.sprites.app" };
const noSleep = async () => {};

describe("spriteFromEnv", () => {
  it("needs both the token and the secret", () => {
    expect(spriteFromEnv({})).toBeNull();
    expect(spriteFromEnv({ FLY_SPRITES_TOKEN: TOKEN })).toBeNull();
    expect(spriteFromEnv({ SPRITE_BROWSER_SECRET: SECRET })).toBeNull();
    expect(spriteFromEnv({ FLY_SPRITES_TOKEN: "", SPRITE_BROWSER_SECRET: SECRET })).toBeNull();
  });

  it("defaults the name and reads an explicit URL", () => {
    expect(spriteFromEnv({ FLY_SPRITES_TOKEN: TOKEN, SPRITE_BROWSER_SECRET: SECRET })).toEqual(
      config,
    );
    expect(
      spriteFromEnv({
        FLY_SPRITES_TOKEN: TOKEN,
        SPRITE_BROWSER_SECRET: SECRET,
        SPRITE_BROWSER_NAME: "other",
        SPRITE_BROWSER_URL: "https://o.sprites.app",
      }),
    ).toEqual({ ...config, name: "other", url: "https://o.sprites.app" });
  });
});

describe("browsersFor", () => {
  it("is the local Chromium alone without a Sprite", () => {
    expect(browsersFor(null)).toEqual(["chromium"]);
  });

  it("adds the Sprite after the local Chromium", () => {
    const browsers = browsersFor(config, { fetch: fakeFetch([], DEFAULT_API).impl });
    expect(browsers).toHaveLength(2);
    expect(browsers[0]).toBe("chromium");
    expect(browsers[1]).toMatchObject({ name: "sprite", reach: "loopback", sessions: 1 });
  });
});

describe("spriteBrowser", () => {
  it("finds the URL through the API, polls /healthz until ready, then connects with the secret", async () => {
    const { impl, calls } = fakeFetch([503, 503, 200], DEFAULT_API);
    const sleep = vi.fn(noSleep);
    const service = spriteBrowser(config, { fetch: impl, sleep });
    const connection = await connect(service);
    expect(connection).toMatchObject({
      endpoint: "wss://demo-1.sprites.app/",
      headers: { [SECRET_HEADER]: SECRET },
    });
    expect(calls[0]?.url).toBe("https://api.sprites.dev/v1/sprites/storyshelf-browser");
    expect(calls[0]?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    const polls = calls.slice(1);
    expect(polls).toHaveLength(3);
    expect(polls.every((c) => c.url === "https://demo-1.sprites.app/healthz")).toBe(true);
    expect(polls.every((c) => c.headers[SECRET_HEADER] === SECRET)).toBe(true);
    expect(polls.every((c) => c.headers["authorization"] === undefined)).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("skips the API when the URL is configured", async () => {
    const { impl, calls } = fakeFetch([200], DEFAULT_API);
    const service = spriteBrowser(
      { ...config, url: "http://local.test:8080" },
      { fetch: impl, sleep: noSleep },
    );
    expect((await connect(service)).endpoint).toBe("ws://local.test:8080/");
    expect(calls.map((c) => c.url)).toEqual(["http://local.test:8080/healthz"]);
  });

  it("shares one wake between concurrent connections", async () => {
    const { impl, calls } = fakeFetch([200], DEFAULT_API);
    const service = spriteBrowser(config, { fetch: impl, sleep: noSleep });
    await Promise.all([connect(service), connect(service)]);
    expect(calls.filter((c) => c.url.startsWith("https://api.sprites.dev/"))).toHaveLength(1);
  });

  it("names the status, never the token or secret, when the API refuses", async () => {
    const { impl } = fakeFetch([], 401);
    const service = spriteBrowser(config, { fetch: impl, sleep: noSleep });
    const failure = await connect(service).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    const text = `${(failure as Error).message}${(failure as Error).stack}`;
    expect(text).toMatch(/401/u);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(SECRET);
  });

  it("fails when the API gives no URL", async () => {
    const { impl } = fakeFetch([], {});
    const service = spriteBrowser(config, { fetch: impl, sleep: noSleep });
    await expect(connect(service)).rejects.toThrow(/no URL/u);
  });

  it("treats a network error as not ready yet", async () => {
    let n = 0;
    const impl = (async (input: URL | string) => {
      if (String(input).includes("/healthz") && (n += 1) === 1) {
        throw new TypeError("fetch failed");
      }
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const service = spriteBrowser(
      { ...config, url: "https://x.sprites.app" },
      { fetch: impl, sleep: noSleep },
    );
    expect((await connect(service)).endpoint).toBe("wss://x.sprites.app/");
  });

  it("stops waiting when the run is cancelled", async () => {
    const { impl } = fakeFetch([503, 503, 503, 503], DEFAULT_API);
    const controller = new AbortController();
    const service = spriteBrowser(config, {
      fetch: impl,
      sleep: async () => {
        controller.abort(new Error("Capture cancelled"));
        throw new Error("Capture cancelled");
      },
    });
    await expect(connect(service, controller.signal)).rejects.toThrow(/cancelled/u);
  });
});
