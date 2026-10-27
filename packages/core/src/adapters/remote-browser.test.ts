import { describe, expect, it } from "vitest";
import type { BrowserName } from "./capture-target.ts";
import {
  defineRemote,
  isRemoteBrowser,
  reachOf,
  remoteTargetsOf,
  scrubConnection,
  type RemoteOptions,
  type RemoteSupport,
} from "./remote-browser.ts";

const all: RemoteSupport = {
  engines: ["chromium", "firefox", "webkit", "chrome"],
  protocols: ["playwright", "cdp"],
  label: "remote()",
};

function options(overrides: Partial<RemoteOptions> = {}): RemoteOptions {
  return {
    name: "grid",
    engines: ["chromium", "firefox"],
    connect: () => ({
      protocol: "playwright",
      endpoint: "ws://farm:3000/",
      exposeNetwork: "<loopback>",
    }),
    sessions: 4,
    ...overrides,
  };
}

const cdp = (engine: string) => ({ protocol: "cdp" as const, endpoint: `wss://x/${engine}` });
const keyed = () => ({ protocol: "playwright" as const, endpoint: "https://secret-key@farm/" });

describe("defineRemote", () => {
  it("validates and fills the defaults", () => {
    const remote = defineRemote(options(), all);
    expect(isRemoteBrowser(remote)).toBe(true);
    expect(remote).toMatchObject({
      name: "grid",
      sessions: 4,
      connectRetries: 3,
      connectBackoffMs: 500,
      connectTimeoutMs: 30_000,
      platform: undefined,
    });
    expect(isRemoteBrowser("chromium")).toBe(false);
    expect(isRemoteBrowser(null)).toBe(false);
  });

  it.each([
    ["an uppercase name", { name: "Grid" }, /name "Grid" must be lowercase/u],
    ["a long name", { name: "a".repeat(33) }, /at most 32/u],
    ["no sessions", { sessions: 0 }, /sessions must be a positive integer/u],
    ["fractional sessions", { sessions: 1.5 }, /sessions must be a positive integer/u],
    ["no engines", { engines: [] }, /at least one engine/u],
    ["an unknown engine", { engines: ["opera" as BrowserName] }, /unknown engine "opera"/u],
    ["a repeated engine", { engines: ["chromium", "chromium"] as BrowserName[] }, /listed twice/u],
  ])("rejects %s", (_label, overrides, message) => {
    expect(() => defineRemote(options(overrides), all)).toThrow(message);
  });

  it("rejects an engine the runner cannot drive", () => {
    expect(() =>
      defineRemote(options(), { ...all, engines: ["chromium", "chrome"], label: "cdp()" }),
    ).toThrow(/cdp\(\) "grid": this runner cannot drive "firefox"/u);
  });

  it("rejects a connection the runner cannot speak, or the protocol cannot do", () => {
    expect(() =>
      defineRemote(options({ connect: cdp }), { ...all, protocols: ["playwright"] }),
    ).toThrow(/protocol "cdp" is not supported/u);
    expect(() => defineRemote(options({ connect: cdp }), all)).toThrow(
      /CDP protocol drives Chromium only, not "firefox"/u,
    );
    expect(() =>
      defineRemote(
        options({
          engines: ["chromium"],
          connect: () => ({ protocol: "cdp", endpoint: "wss://x", exposeNetwork: "<loopback>" }),
        }),
        all,
      ),
    ).toThrow(/exposeNetwork needs the "playwright" protocol/u);
  });

  it("rejects an endpoint with the wrong scheme, without printing it", () => {
    expect(() => defineRemote(options({ connect: keyed }), all)).toThrow(
      /must be a ws: or wss: URL/u,
    );
    expect(() => defineRemote(options({ connect: keyed }), all)).not.toThrow(/secret-key/u);
    expect(() =>
      defineRemote(options({ connect: () => ({ protocol: "playwright", endpoint: "nope" }) }), all),
    ).toThrow(/must be a ws: or wss: URL/u);
  });

  it("accepts an http endpoint for CDP", () => {
    expect(() =>
      defineRemote(
        options({
          engines: ["chromium"],
          connect: () => ({ protocol: "cdp", endpoint: "http://chrome:9222" }),
        }),
        all,
      ),
    ).not.toThrow();
  });
});

describe("remoteTargetsOf", () => {
  it("expands to one target per engine, named engine@name, with how it reaches the Storybook", () => {
    const remote = defineRemote(options(), all);
    expect(
      remoteTargetsOf(remote).map(({ target, engine, reach }) => ({ target, engine, reach })),
    ).toEqual([
      { target: "chromium@grid", engine: "chromium", reach: "loopback" },
      { target: "firefox@grid", engine: "firefox", reach: "loopback" },
    ]);
  });

  it("needs a URL unless the connection routes back to this host", () => {
    expect(reachOf({ protocol: "playwright", endpoint: "wss://x" })).toBe("url");
    expect(
      reachOf({ protocol: "playwright", endpoint: "wss://x", exposeNetwork: "<loopback>" }),
    ).toBe("loopback");
    expect(reachOf({ protocol: "cdp", endpoint: "wss://x" })).toBe("url");
  });
});

describe("scrubConnection", () => {
  const connection = {
    protocol: "playwright" as const,
    endpoint: "wss://user:pw-1234@farm.example/ws?caps=%7B%22key%22%3A%22abcd1234%22%7D&k=tok-5678",
    headers: { authorization: "Bearer hdr-token-9" },
  };

  it("removes the endpoint, its query values and header values from a message", () => {
    const text = `connect to ${connection.endpoint} failed: bad Bearer hdr-token-9; tok-5678 and pw-1234 and {"key":"abcd1234"}`;
    const scrubbed = scrubConnection(text, connection);
    for (const secret of ["pw-1234", "tok-5678", "hdr-token-9", "abcd1234", "farm.example"]) {
      expect(scrubbed).not.toContain(secret);
    }
    expect(scrubbed).toContain("[redacted]");
  });

  it("scrubs the endpoint a driver echoes without its query, path and host included", () => {
    const echoed = {
      protocol: "playwright" as const,
      endpoint: "ws://farm.internal:3000/s3cret-path?x=1",
    };
    expect(
      scrubConnection("WebSocket error: ws://farm.internal:3000/s3cret-path 401", echoed),
    ).toBe("WebSocket error: [redacted] 401");
    expect(scrubConnection("to farm.internal:3000 via /s3cret-path", echoed)).toBe(
      "to [redacted] via [redacted]",
    );
  });

  it("scrubs an endpoint that is not a URL whole, and leaves short fragments alone", () => {
    expect(
      scrubConnection("bad endpoint-thing here", { protocol: "cdp", endpoint: "endpoint-thing" }),
    ).toBe("bad [redacted] here");
    expect(scrubConnection("a b", { protocol: "cdp", endpoint: "b" })).toBe("a b");
  });
});

const acquire = async () => await Promise.resolve({ ...keyed(), lease: "x" });
const release = (): void => {};

describe("lifecycle hooks", () => {
  it("keeps acquire, release and the acquire timeout on the entry", () => {
    const remote = defineRemote(options({ acquire, release, connectTimeoutMs: 1000 }), all);
    expect(remote.acquire).toBe(acquire);
    expect(remote.release).toBe(release);
    expect(remote.acquireTimeoutMs).toBe(1000);
    expect(defineRemote(options({ acquireTimeoutMs: 5 }), all).acquireTimeoutMs).toBe(5);
    expect(defineRemote(options(), all).acquireTimeoutMs).toBe(30_000);
  });

  it("refuses release without acquire", () => {
    expect(() => defineRemote(options({ release: () => {} }), all)).toThrow(
      'remote() "grid": release needs acquire',
    );
  });

  it("takes sessions as a function and validates what it returns", () => {
    let cap = 2;
    const remote = defineRemote(options({ sessions: () => cap }), all);
    expect(typeof remote.sessions).toBe("function");
    expect(() => defineRemote(options({ sessions: () => 0 }), all)).toThrow(
      "sessions must be a positive integer",
    );
    cap = 3;
  });

  it("scrubs strings of a lease that carry credentials", () => {
    const connection = {
      ...keyed(),
      lease: { token: "lease-secret-1", nested: { key: "deep-secret-2" } },
    };
    const scrubbed = scrubConnection("failed with lease-secret-1 and deep-secret-2", connection);
    expect(scrubbed).toBe("failed with [redacted] and [redacted]");
  });
});
