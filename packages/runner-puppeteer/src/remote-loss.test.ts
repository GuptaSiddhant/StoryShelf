import { describe, expect, it } from "vite-plus/test";
import { RemoteBrowserLostError, browserLost } from "./remote-loss.ts";

const run = { cancelled: false };

function notAsked(): boolean {
  throw new Error("not asked");
}

describe("browserLost", () => {
  it("is true for a remote run whose browser is no longer connected", () => {
    expect(browserLost(true, run, () => false)).toBe(true);
  });

  it("is false while the browser is connected", () => {
    expect(browserLost(true, run, () => true)).toBe(false);
  });

  it("never asks a local run's browser", () => {
    expect(browserLost(false, run, notAsked)).toBe(false);
  });

  it("does not read a cancel as a loss, because a cancel closes the browser", () => {
    expect(browserLost(true, { cancelled: true }, () => false)).toBe(false);
    const abort = new AbortController();
    abort.abort();
    expect(browserLost(true, { cancelled: false, abort }, () => false)).toBe(false);
  });
});

describe("RemoteBrowserLostError", () => {
  it("names the drop and carries no cause that could name the endpoint", () => {
    const error = new RemoteBrowserLostError();
    expect(error.name).toBe("RemoteBrowserLostError");
    expect(error.message).toBe("The remote browser disconnected during the capture pass");
    expect(error.cause).toBeUndefined();
  });
});
