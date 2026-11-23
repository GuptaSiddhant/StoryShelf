import { describe, expect, it } from "vitest";
import { importPeer, missingPeerError } from "./peers.ts";

describe("missingPeerError", () => {
  it("names the peer, the runner and the install line, and keeps the cause", () => {
    const cause = new Error("Cannot find package");
    const error = missingPeerError("pngjs", cause);
    expect(error.message).toContain("`pngjs`");
    expect(error.message).toContain("@storyshelf/runner");
    expect(error.message).toContain("nub add pngjs pixelmatch");
    expect(error.cause).toBe(cause);
  });
});

describe("importPeer", () => {
  it("returns the loaded module", async () => {
    await expect(importPeer("pngjs", async () => await Promise.resolve(1))).resolves.toBe(1);
  });

  it("turns a failed import into the guided error", async () => {
    await expect(
      importPeer("pixelmatch", async () => await Promise.reject(new Error("nope"))),
    ).rejects.toThrow("`pixelmatch`");
  });
});
