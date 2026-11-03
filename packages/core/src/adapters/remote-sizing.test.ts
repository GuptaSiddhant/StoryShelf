import { describe, expect, it, vi } from "vitest";
import { defineRemote, type RemoteOptions } from "./remote-browser.ts";
import { UNVERIFIED_NOTE, logRemoteSizing, remoteSizingOf } from "./remote-sizing.ts";

const SUPPORT = { engines: ["chromium", "firefox"], protocols: ["playwright"], label: "remote()" };

const service = (extra: Partial<RemoteOptions> = {}) =>
  defineRemote(
    {
      name: "grid",
      engines: ["chromium"],
      sessions: 4,
      protocol: "playwright",
      reach: "loopback",
      connect: { endpoint: "wss://secret.example/?key=hunter2", headers: { authorization: "x" } },
      ...extra,
    },
    SUPPORT as never,
  );

describe("remoteSizingOf", () => {
  it("reports the configured and effective limits with their scope", () => {
    const sizing = remoteSizingOf(
      "chromium@grid",
      service({ maxPagesPerConnection: 2, maxConnections: 3 }),
    );
    expect(sizing).toEqual({
      target: "chromium@grid",
      pages: 4,
      pagesPerConnection: 2,
      effectivePagesPerConnection: 2,
      maxConnections: 3,
      scope: { pages: "target", connections: "process" },
      experimental: false,
    });
  });

  it("reports an uncapped limit as null, and the page gate as the connection's pages", () => {
    const sizing = remoteSizingOf("chromium@grid", service());
    expect(sizing).toMatchObject({
      pagesPerConnection: null,
      effectivePagesPerConnection: 4,
      maxConnections: null,
    });
  });

  it("caps a connection's pages at the page gate when that is lower", () => {
    const sizing = remoteSizingOf("chromium@grid", service({ maxPagesPerConnection: 9 }));
    expect(sizing.effectivePagesPerConnection).toBe(4);
  });

  it("reads a live sessions function now, and reads a failing one as unknown", () => {
    let live = 2;
    const remote = service({ sessions: () => live });
    expect(remoteSizingOf("chromium@grid", remote).pages).toBe(2);
    live = 5;
    expect(remoteSizingOf("chromium@grid", remote).pages).toBe(5);
    live = Number.NaN;
    expect(remoteSizingOf("chromium@grid", remote).pages).toBeNull();
    let failing = false;
    const broken = service({
      sessions: () => {
        if (failing) {
          throw new Error("boom");
        }
        return 1;
      },
    });
    failing = true;
    expect(remoteSizingOf("chromium@grid", broken).pages).toBeNull();
  });

  it("says an experimental preset is unverified", () => {
    const sizing = remoteSizingOf("chromium@grid", service({ experimental: true }));
    expect(sizing).toMatchObject({ experimental: true, verification: UNVERIFIED_NOTE });
  });
});

describe("logRemoteSizing", () => {
  it("logs once and never carries the endpoint, headers or credentials", () => {
    const info = vi.fn();
    logRemoteSizing({ info }, "chromium@grid", service({ experimental: true }));
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[1]).toBe("remote sizing");
    const text = JSON.stringify(info.mock.calls);
    expect(text).not.toMatch(/secret\.example|hunter2|authorization/u);
  });

  it("does nothing without a logger", () => {
    expect(() => logRemoteSizing(undefined, "chromium@grid", service())).not.toThrow();
  });
});
