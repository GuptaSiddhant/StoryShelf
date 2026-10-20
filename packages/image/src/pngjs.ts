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
    const out = new PNG({ width, height });
    out.data.set(data);
    return PNG.sync.write(out);
  },
  downscale: downscaleWithPngjs,
};
