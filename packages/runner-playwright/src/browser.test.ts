import type { HeldConnection } from "@storyshelf/core/adapter/capture-runner";
import type { Browser } from "playwright-core";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  activeRuns,
  cancelRuns,
  closeBrowser,
  finishing,
  holdLease,
  messageOf,
  outcomeOf,
  safeCloseBrowser,
  trackRun,
} from "./browser.ts";

const browserOf = (): Browser => ({ close: vi.fn(async () => await Promise.resolve()) }) as never;
const leaseOf = (end = vi.fn(async () => await Promise.resolve())): HeldConnection =>
  ({ connection: { endpoint: "ws://x/" }, end }) as never;

describe("outcomeOf", () => {
  it("lets a cancel win over a failure, and a failure over a finish", () => {
    expect(outcomeOf({ cancelled: true }, true)).toBe("cancelled");
    expect(outcomeOf({ cancelled: false }, true)).toBe("failed");
    expect(outcomeOf({ cancelled: false }, false)).toBe("finished");
  });
});

describe("closing a browser that holds a lease", () => {
  it("ends the lease with the outcome and error after closing the browser", async () => {
    const browser = browserOf();
    const end = vi.fn(async () => await Promise.resolve());
    holdLease(browser, leaseOf(end));
    const cause = new Error("render failed");
    await safeCloseBrowser(browser, "failed", cause);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledWith("failed", cause);
  });

  it("releases even when closing the browser throws", async () => {
    const browser = { close: vi.fn(() => Promise.reject(new Error("gone"))) } as never as Browser;
    const end = vi.fn(async () => await Promise.resolve());
    holdLease(browser, leaseOf(end));
    await closeBrowser(browser);
    expect(end).toHaveBeenCalledWith("cancelled", undefined);
  });

  it("does nothing for a null browser or one without a lease", async () => {
    await expect(closeBrowser(null)).resolves.toBeUndefined();
    await expect(safeCloseBrowser(browserOf())).resolves.toBeUndefined();
  });
});

describe("finishing", () => {
  it("passes a thrown error to finish, as failed, and rethrows it", async () => {
    const browser = browserOf();
    const end = vi.fn(async () => await Promise.resolve());
    holdLease(browser, leaseOf(end));
    const boom = new Error("boom");
    await expect(
      finishing(
        () => Promise.reject(boom),
        async (failed, error) => {
          await safeCloseBrowser(browser, outcomeOf({ cancelled: false }, failed), error);
        },
      ),
    ).rejects.toBe(boom);
    expect(end).toHaveBeenCalledWith("failed", boom);
  });

  it("finishes as finished when the work resolves", async () => {
    const finish = vi.fn(async () => await Promise.resolve());
    await expect(finishing(async () => await Promise.resolve(7), finish)).resolves.toBe(7);
    expect(finish).toHaveBeenCalledWith(false, undefined);
  });
});

describe("messageOf", () => {
  it("gives an Error's message exactly", () => {
    expect(messageOf(new Error("boom", { cause: new Error("inner") }))).toBe("boom");
  });

  it("says what a non-Error value says instead of [object Object]", () => {
    expect(messageOf({ type: "error", error: new Error("ECONNREFUSED") })).toBe("ECONNREFUSED");
    expect(messageOf("plain")).toBe("plain");
    expect(messageOf(null)).toBe("unknown error");
    expect(messageOf({})).toBe("unknown error");
  });

  it("redacts secrets in a value that is not an Error", () => {
    expect(messageOf({ message: "refused, api_key=supersecret" })).not.toContain("supersecret");
  });
});

describe("trackRun and cancelRuns", () => {
  it("registers the run while it works, and removes it however it ends", async () => {
    await trackRun({ buildId: "track-1", runId: "a" }, async () => {
      expect(activeRuns.matching("track-1", "a")).toHaveLength(1);
      return await Promise.resolve();
    });
    expect(activeRuns.matching("track-1")).toHaveLength(0);
    await expect(
      trackRun({ buildId: "track-1", runId: "a" }, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(activeRuns.matching("track-1")).toHaveLength(0);
  });

  it("cancels exactly the runs it names, aborting them and closing their browsers", async () => {
    const browser = browserOf();
    let named: { cancelled: boolean; abort?: AbortController | undefined } | undefined;
    let other: { cancelled: boolean } | undefined;
    const started = Promise.withResolvers<boolean>();
    const finish = Promise.withResolvers<boolean>();
    const first = trackRun({ buildId: "track-2", runId: "a" }, async (active) => {
      active.browser = browser;
      named = active;
      started.resolve(true);
      await finish.promise;
    });
    const second = trackRun({ buildId: "track-2", runId: "b" }, async (active) => {
      other = active;
      await finish.promise;
    });
    await started.promise;
    await cancelRuns("track-2", "a");
    expect(named?.cancelled).toBe(true);
    expect(named?.abort?.signal.aborted).toBe(true);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(other?.cancelled).toBe(false);
    finish.resolve(true);
    await Promise.all([first, second]);
  });
});
