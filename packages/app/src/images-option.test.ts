import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { createShelfApp } from "./index.tsx";
import { stubRunner } from "./test-runner.ts";

describe("images.engine", () => {
  it("hands testing.images and testing.compare to the runner's image engine", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const runner = stubRunner();
    const configure = vi.spyOn(runner.images, "configure");
    createShelfApp({
      database: db,
      storage,
      testing: { runner, images: { engine: "sharp" }, compare: { threads: 2 } },
    });
    expect(configure).toHaveBeenCalledWith({ engine: "sharp", threads: 2 });
  });

  it("fails when the app is created if the engine refuses the settings", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const runner = stubRunner();
    vi.spyOn(runner.images, "configure").mockImplementation(() => {
      throw new Error('Unknown image engine "magick"');
    });
    expect(() =>
      createShelfApp({
        database: db,
        storage,
        testing: { runner, images: { engine: "magick" as never } },
      }),
    ).toThrow(/Unknown image engine "magick"/u);
  });

  it("boots ready with the sharp engine", async () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    const app = createShelfApp({
      database: db,
      storage,
      testing: { runner: stubRunner(), images: { engine: "sharp" } },
    });
    await app.lifecycle.setup();
    expect((await app.lifecycle.ready).ok).toBe(true);
    await app.lifecycle.teardown();
  });
});
