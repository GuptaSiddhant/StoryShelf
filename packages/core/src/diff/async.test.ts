import { afterEach, describe, expect, it } from "vitest";
import { configureImages, imageEngineState, shutdownDiffPool } from "./async.ts";

afterEach(async () => {
  configureImages({});
  await shutdownDiffPool();
});

describe("imageEngineState", () => {
  it("reports the configured engine and worker count", () => {
    configureImages({ engine: "pngjs", threads: 3 });
    expect(imageEngineState()).toEqual({ engine: "pngjs", workers: 3, inThread: false });
  });

  it("is in-thread when workers are turned off", () => {
    configureImages({ engine: "pngjs", threads: 0 });
    expect(imageEngineState()).toMatchObject({ workers: 0, inThread: true });
  });

  it("starts no worker to answer", async () => {
    configureImages({ engine: "pngjs", threads: 2 });
    imageEngineState();
    // Nothing to shut down: the pool is only created by a diff.
    await expect(shutdownDiffPool()).resolves.toBeUndefined();
  });
});
