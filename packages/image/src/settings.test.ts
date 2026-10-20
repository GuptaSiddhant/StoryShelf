import { afterEach, describe, expect, it } from "vitest";
import { IMAGE_ENGINE_ENV } from "./codec.ts";
import {
  configuredThreadCount,
  currentImageEngine,
  setImageSettings,
  verifyImageEngine,
} from "./settings.ts";

afterEach(() => {
  setImageSettings({});
  Reflect.deleteProperty(process.env, IMAGE_ENGINE_ENV);
});

describe("image settings", () => {
  it("defaults to pngjs with no thread override", () => {
    setImageSettings({});
    expect([currentImageEngine(), configuredThreadCount()]).toEqual(["pngjs", undefined]);
  });

  it("takes the configured engine and threads", () => {
    setImageSettings({ engine: "sharp", threads: 2 });
    expect([currentImageEngine(), configuredThreadCount()]).toEqual(["sharp", 2]);
  });

  it("lets the option beat STORYSHELF_IMAGE_ENGINE", () => {
    process.env[IMAGE_ENGINE_ENV] = "sharp";
    setImageSettings({ engine: "pngjs" });
    expect(currentImageEngine()).toBe("pngjs");
    setImageSettings({});
    expect(currentImageEngine()).toBe("sharp");
  });

  it("rejects an unknown engine at configuration time", () => {
    expect(() => setImageSettings({ engine: "nope" })).toThrow(/Unknown image engine/u);
  });

  it("verifies the configured engine's dependencies load", async () => {
    setImageSettings({ engine: "sharp" });
    expect(await verifyImageEngine()).toBe("sharp");
    setImageSettings({ engine: "pngjs" });
    expect(await verifyImageEngine()).toBe("pngjs");
  });
});
