import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { downscaleWithPngjs } from "./pngjs-downscale.ts";

function solid(width: number, height: number, value: number): Uint8Array {
  const image = new PNG({ width, height });
  image.data.fill(value);
  return new Uint8Array(PNG.sync.write(image));
}

describe("downscaleWithPngjs", () => {
  it("averages boxes down to the long-edge limit", () => {
    const out = PNG.sync.read(Buffer.from(downscaleWithPngjs(solid(120, 60, 200), 30)));
    expect([out.width, out.height]).toEqual([30, 15]);
    expect(out.data[0]).toBe(200);
  });

  it("never enlarges a small image", () => {
    const out = PNG.sync.read(Buffer.from(downscaleWithPngjs(solid(20, 10, 7), 100)));
    expect([out.width, out.height]).toEqual([20, 10]);
  });
});
