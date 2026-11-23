import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubLogger } from "../jobs/consumer/test-fixtures.ts";

const images = vi.hoisted(() => ({
  configureImages: vi.fn(),
  verifyImageEngine: vi.fn(async () => "pngjs"),
}));
vi.mock("../diff/index.ts", () => images);

const { applyImageSettings, ensureImageEngine } = await import("./image-engine.ts");

beforeEach(() => {
  images.configureImages.mockClear();
  images.verifyImageEngine.mockReset().mockResolvedValue("pngjs");
});

describe("applyImageSettings", () => {
  it("applies images and compare options like the server does", () => {
    applyImageSettings({ engine: "sharp" }, { threads: 2 });
    expect(images.configureImages).toHaveBeenCalledWith({ engine: "sharp", threads: 2 });
  });

  it("leaves the process-wide settings alone when none are given", () => {
    applyImageSettings();
    expect(images.configureImages).not.toHaveBeenCalled();
  });
});

describe("ensureImageEngine", () => {
  it("resolves once the engine loads", async () => {
    await expect(ensureImageEngine(stubLogger().logger)).resolves.toBeUndefined();
  });

  it("logs and rethrows when the engine cannot load", async () => {
    images.verifyImageEngine.mockRejectedValue(new Error("sharp is not installed"));
    const log = stubLogger();
    await expect(ensureImageEngine(log.logger)).rejects.toThrow("sharp is not installed");
    expect(log.calls).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "image engine cannot load; capture consumer stopping",
      }),
    );
  });
});
