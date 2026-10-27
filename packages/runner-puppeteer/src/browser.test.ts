import type { HeldConnection } from "@storyshelf/core/adapter/capture-runner";
import type { Browser } from "puppeteer-core";
import { describe, expect, it, vi } from "vitest";
import { closeBrowser, finishing, holdLease, outcomeOf, safeCloseBrowser } from "./browser.ts";

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
