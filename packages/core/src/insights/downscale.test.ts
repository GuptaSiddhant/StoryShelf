import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { downscalePng } from "./downscale.ts";

function png(width: number, height: number): Uint8Array {
  const image = new PNG({ width, height });
  image.data.fill(255);
  return new Uint8Array(PNG.sync.write(image));
}

describe("downscalePng", () => {
  it("shrinks so the long edge fits and keeps the aspect ratio", () => {
    const out = PNG.sync.read(Buffer.from(downscalePng(png(1000, 500), 100)));
    expect(out.width).toBe(100);
    expect(out.height).toBe(50);
  });

  it("returns small images unchanged in size", () => {
    const out = PNG.sync.read(Buffer.from(downscalePng(png(40, 20), 100)));
    expect([out.width, out.height]).toEqual([40, 20]);
  });
});
