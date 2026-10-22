import { makeDatabase, makeStorage } from "@storyshelf/core/test-helpers";
import { describe, expect, it } from "vitest";
import { createShelfApp } from "./index.tsx";
import { stubRunner } from "./test-runner.ts";

describe("images.engine", () => {
  it("rejects an unknown engine when the app is created", () => {
    const { db } = makeDatabase();
    const { storage } = makeStorage();
    expect(() =>
      createShelfApp({
        database: db,
        storage,
        testing: { runner: stubRunner(), images: { engine: "magick" as never } },
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
