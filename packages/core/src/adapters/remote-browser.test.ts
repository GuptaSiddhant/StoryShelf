import { describe, expect, it } from "vitest";
import type { BrowserName } from "./capture-target.ts";
import {
  defineRemote,
  hasSchemeFor,
  isRemoteBrowser,
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
    protocol: "playwright",
    reach: "loopback",
    connect: { endpoint: "ws://farm:3000/" },
    sessions: 4,
    ...overrides,
  };
}

describe("defineRemote", () => {
  it("validates and fills the defaults", () => {
    const remote = defineRemote(options(), all);
    expect(isRemoteBrowser(remote)).toBe(true);
    expect(remote).toMatchObject({
      name: "grid",
      sessions: 4,
      protocol: "playwright",
      reach: "loopback",
      retry: { attempts: 3, backoffMs: 500 },
      timeouts: { acquireMs: 30_000, connectMs: 30_000, releaseMs: 30_000 },
      platform: undefined,
    });
    expect(isRemoteBrowser("chromium")).toBe(false);
    expect(isRemoteBrowser(null)).toBe(false);
  });

  it("takes retry and timeouts, and rejects values that are not whole numbers", () => {
    const remote = defineRemote(
      options({ retry: { attempts: 0, backoffMs: 1 }, timeouts: { acquireMs: 5, releaseMs: 7 } }),
      all,
    );
    expect(remote.retry).toEqual({ attempts: 0, backoffMs: 1 });
    expect(remote.timeouts).toEqual({ acquireMs: 5, connectMs: 30_000, releaseMs: 7 });
    expect(() => defineRemote(options({ timeouts: { connectMs: 0 } }), all)).toThrow(
      /timeouts.connectMs must be an integer of at least 1/u,
    );
    expect(() => defineRemote(options({ retry: { attempts: 1.5 } }), all)).toThrow(
      /retry.attempts must be an integer of at least 0/u,
    );
  });

  it.each([
    ["an uppercase name", { name: "Grid" }, /name "Grid" must be lowercase/u],
    ["a long name", { name: "a".repeat(33) }, /at most 32/u],
    ["no sessions", { sessions: 0 }, /sessions must be a positive integer/u],
    ["fractional sessions", { sessions: 1.5 }, /sessions must be a positive integer/u],
    ["sessions returning zero", { sessions: () => 0 }, /sessions must be a positive integer/u],
    ["no engines", { engines: [] }, /at least one engine/u],
    ["an unknown engine", { engines: ["opera" as BrowserName] }, /unknown engine "opera"/u],
    ["a repeated engine", { engines: ["chromium", "chromium"] as BrowserName[] }, /listed twice/u],
    ["a reach that is neither", { reach: "both" as never }, /reach must be "loopback" or "url"/u],
  ])("rejects %s", (_label, overrides, message) => {
    expect(() => defineRemote(options(overrides), all)).toThrow(message);
  });

  it("rejects an engine the runner cannot drive", () => {
    expect(() =>
      defineRemote(options(), { ...all, engines: ["chromium", "chrome"], label: "cdp()" }),
    ).toThrow(/cdp\(\) "grid": this runner cannot drive "firefox"/u);
  });

  it("requires protocol and reach to be declared, saying what changed", () => {
    const old = { ...options(), protocol: undefined, reach: undefined } as unknown as RemoteOptions;
    expect(() => defineRemote(old, all)).toThrow(/"protocol" and "reach" are required in 0.8/u);
  });

  it.each([
    ["acquire", /option "acquire" is gone in 0.8: merge it into `connect`/u],
    ["exposeNetwork", /option "exposeNetwork" is gone in 0.8: declare `reach: "loopback"`/u],
    ["connectRetries", /use `retry: \{ attempts \}`/u],
    ["connectBackoffMs", /use `retry: \{ backoffMs \}`/u],
    ["connectTimeoutMs", /use `timeouts: \{ connectMs \}`/u],
    ["acquireTimeoutMs", /use `timeouts: \{ acquireMs \}`/u],
  ])("names where the 0.7 option %s went", (key, message) => {
    expect(() => defineRemote({ ...options(), [key]: 1 } as RemoteOptions, all)).toThrow(message);
  });

  it("rejects an option it does not know", () => {
    expect(() => defineRemote({ ...options(), nope: 1 } as RemoteOptions, all)).toThrow(
      /unknown option "nope"/u,
    );
  });

  it("rejects a protocol the runner cannot speak, and CDP where it cannot work", () => {
    const cdp = options({ protocol: "cdp", reach: "url", engines: ["chromium"] });
    expect(() => defineRemote(cdp, { ...all, protocols: ["playwright"] })).toThrow(
      /protocol "cdp" is not supported/u,
    );
    expect(() => defineRemote(options({ protocol: "cdp", reach: "url" }), all)).toThrow(
      /CDP protocol drives Chromium only, not "firefox"/u,
    );
    expect(() => defineRemote({ ...cdp, reach: "loopback" }, all)).toThrow(
      /reach "loopback" needs the "playwright" protocol/u,
    );
  });

  it("rejects a fixed endpoint with the wrong scheme, without printing it", () => {
    const bad = options({ connect: { endpoint: "https://secret-key@farm/" } });
    expect(() => defineRemote(bad, all)).toThrow(/must be a ws: or wss: URL/u);
    expect(() => defineRemote(bad, all)).not.toThrow(/secret-key/u);
    expect(() => defineRemote(options({ connect: { endpoint: "nope" } }), all)).toThrow(
      /must be a ws: or wss: URL/u,
    );
  });

  it("rejects a fixed connection with fields it does not take", () => {
    expect(() =>
      defineRemote(
        options({ connect: { endpoint: "ws://x/", exposeNetwork: "<loopback>" } as never }),
        all,
      ),
    ).toThrow(/connect has unknown field\(s\) exposeNetwork/u);
  });

  it("accepts an http endpoint for CDP", () => {
    expect(() =>
      defineRemote(
        options({
          protocol: "cdp",
          reach: "url",
          engines: ["chromium"],
          connect: { endpoint: "http://chrome:9222" },
        }),
        all,
      ),
    ).not.toThrow();
  });

  it("does not call a function connect at creation, and refuses release without one", () => {
    let calls = 0;
    const remote = defineRemote(
      options({
        connect: () => {
          calls += 1;
          return { endpoint: "ws://x/" };
        },
        release: () => {},
      }),
      all,
    );
    expect(calls).toBe(0);
    expect(typeof remote.connect).toBe("function");
    expect(() => defineRemote(options({ release: () => {} }), all)).toThrow(
      /release needs a function connect/u,
    );
  });

  it("keeps sessions as a function and validates what it returns once", () => {
    let calls = 0;
    const remote = defineRemote(
      options({
        sessions: () => {
          calls += 1;
          return 3;
        },
      }),
      all,
    );
    expect(typeof remote.sessions).toBe("function");
    expect(calls).toBe(1);
  });
});

describe("remoteTargetsOf", () => {
  it("expands to one target per engine, named engine@name, with the declared reach", () => {
    const remote = defineRemote(options(), all);
    expect(
      remoteTargetsOf(remote).map(({ target, engine, reach }) => ({ target, engine, reach })),
    ).toEqual([
      { target: "chromium@grid", engine: "chromium", reach: "loopback" },
      { target: "firefox@grid", engine: "firefox", reach: "loopback" },
    ]);
    expect(remoteTargetsOf(defineRemote(options({ reach: "url" }), all))[0]?.reach).toBe("url");
  });
});

describe("hasSchemeFor", () => {
  it("accepts WebSocket for Playwright and also http for CDP", () => {
    expect(hasSchemeFor("playwright", "wss://x")).toBe(true);
    expect(hasSchemeFor("playwright", "https://x")).toBe(false);
    expect(hasSchemeFor("cdp", "https://x")).toBe(true);
    expect(hasSchemeFor("cdp", "not a url")).toBe(false);
  });
});

describe("scrubConnection", () => {
  const connection = {
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
    const echoed = { endpoint: "ws://farm.internal:3000/s3cret-path?x=1" };
    expect(
      scrubConnection("WebSocket error: ws://farm.internal:3000/s3cret-path 401", echoed),
    ).toBe("WebSocket error: [redacted] 401");
    expect(scrubConnection("to farm.internal:3000 via /s3cret-path", echoed)).toBe(
      "to [redacted] via [redacted]",
    );
  });

  it("scrubs an endpoint that is not a URL whole, and leaves short fragments alone", () => {
    expect(scrubConnection("bad endpoint-thing here", { endpoint: "endpoint-thing" })).toBe(
      "bad [redacted] here",
    );
    expect(scrubConnection("a b", { endpoint: "b" })).toBe("a b");
  });

  it("scrubs every value of a lease, strings, numbers and nested ones", () => {
    const leased = {
      endpoint: "wss://farm.example/",
      lease: { token: "lease-secret-1", nested: { key: "deep-secret-2" }, id: 1234567 },
    };
    expect(scrubConnection("a lease-secret-1 b deep-secret-2 c 1234567", leased)).toBe(
      "a [redacted] b [redacted] c [redacted]",
    );
    expect(
      scrubConnection("x lease-text-99", { endpoint: "wss://h/", lease: "lease-text-99" }),
    ).toBe("x [redacted]");
  });
});
