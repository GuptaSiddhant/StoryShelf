/** The default codec: pure JavaScript (pngjs), runs on every runtime. */
import { PNG } from "pngjs";
import type { ImageCodec, RgbaImage } from "./codec.ts";
import { downscaleWithPngjs } from "./pngjs-downscale.ts";

export const pngjsCodec: ImageCodec = {
  name: "pngjs",
  decode(png: Buffer): RgbaImage {
    const { width, height, data } = PNG.sync.read(png);
    return { width, height, data };
  },
  encode({ width, height, data }: RgbaImage): Buffer {
    // The packer only reads `width`, `height` and `data`, so hand it the pixels as they are
    // instead of copying a full frame into a fresh PNG.
    const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return PNG.sync.write({ width, height, data: view } as PNG);
  },
  downscale: downscaleWithPngjs,
};
