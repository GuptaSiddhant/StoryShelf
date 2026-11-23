import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";
import { createImageEngine } from "./index.ts";

/** A grey `width` x `height` PNG. */
function png(width: number, height: number): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(200);
  return PNG.sync.write(image);
}

const OPTIONS = {
  pixelThreshold: 0.1,
  maxDiffRatio: 0,
  includeAntialiasing: false,
  failOnSizeChange: true,
};

const engine = createImageEngine();

afterEach(async () => {
  await engine.shutdown();
  engine.configure({});
});

describe("createImageEngine", () => {
  it("compares on the configured pool", async () => {
    engine.configure({ threads: 0 });
    const result = await engine.compare(png(2, 2), png(2, 2), OPTIONS);
    expect(result).toMatchObject({ passed: true, diffPixels: 0 });
  });

  it("reports the engine and pool in effect without starting a worker", () => {
    engine.configure({ engine: "pngjs", threads: 0 });
    expect(engine.state()).toEqual({ engine: "pngjs", workers: 0, inThread: true });
  });

  it("verifies the configured library", async () => {
    engine.configure({ engine: "pngjs" });
    await expect(engine.verify()).resolves.toBe("pngjs");
  });

  it("downscales a PNG and keeps it a PNG", async () => {
    const small = PNG.sync.read(Buffer.from(await engine.downscale(png(40, 20), 10)));
    expect({ width: small.width, height: small.height }).toEqual({ width: 10, height: 5 });
  });

  it("refuses an unknown engine name", () => {
    expect(() => {
      engine.configure({ engine: "gimp" });
    }).toThrow('Unknown image engine "gimp"');
  });
});
