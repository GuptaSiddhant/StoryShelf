import { describe, expect, it, vi } from "vitest";
import type { ImageEngine } from "../adapters/image-engine.ts";
import { stubLogger } from "../jobs/consumer/test-fixtures.ts";
import { applyImageSettings, ensureImageEngine } from "./image-engine.ts";

function engine(verify: ImageEngine["verify"] = async () => await Promise.resolve("pngjs")) {
  return {
    configure: vi.fn(),
    verify: vi.fn(verify),
    compare: vi.fn(),
    downscale: vi.fn(),
    state: vi.fn(),
    shutdown: vi.fn(),
  } satisfies ImageEngine;
}

describe("applyImageSettings", () => {
  it("applies images and compare options like the server does", () => {
    const images = engine();
    applyImageSettings(images, { engine: "sharp" }, { threads: 2 });
    expect(images.configure).toHaveBeenCalledWith({ engine: "sharp", threads: 2 });
  });

  it("leaves the engine's settings alone when none are given", () => {
    const images = engine();
    applyImageSettings(images);
    expect(images.configure).not.toHaveBeenCalled();
  });
});

describe("ensureImageEngine", () => {
  it("resolves once the engine loads", async () => {
    const images = engine();
    await expect(ensureImageEngine(images, stubLogger().logger)).resolves.toBeUndefined();
    expect(images.verify).toHaveBeenCalledTimes(1);
  });

  it("logs and rethrows when the engine cannot load", async () => {
    const images = engine(async () => {
      throw new Error("sharp is not installed");
    });
    const log = stubLogger();
    await expect(ensureImageEngine(images, log.logger)).rejects.toThrow("sharp is not installed");
    expect(log.calls).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "image engine cannot load; capture consumer stopping",
      }),
    );
  });
});
