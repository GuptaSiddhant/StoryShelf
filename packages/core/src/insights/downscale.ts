/** PNG thumbnails via `pngjs` (no new image dependency; output stays PNG). */
import { PNG } from "pngjs";

/** Downscale a PNG so its long edge is at most `maxEdge` (box sampling). */
export function downscalePng(buffer: Uint8Array, maxEdge: number): Uint8Array {
  const src = PNG.sync.read(Buffer.from(buffer));
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  if (scale >= 1) {
    return new Uint8Array(PNG.sync.write(src));
  }
  const dst = new PNG({
    width: Math.max(1, Math.round(src.width * scale)),
    height: Math.max(1, Math.round(src.height * scale)),
  });
  for (let row = 0; row < dst.height; row += 1) {
    for (let col = 0; col < dst.width; col += 1) {
      writePixel(dst, col, row, averageBox(src, boxOf(src, col, row, 1 / scale)));
    }
  }
  return new Uint8Array(PNG.sync.write(dst));
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(src: PNG, col: number, row: number, factor: number): Box {
  const x0 = Math.floor(col * factor);
  const y0 = Math.floor(row * factor);
  return {
    x0,
    y0,
    x1: Math.min(src.width, Math.max(x0 + 1, Math.floor((col + 1) * factor))),
    y1: Math.min(src.height, Math.max(y0 + 1, Math.floor((row + 1) * factor))),
  };
}

function averageBox(src: PNG, box: Box): number[] {
  const sum = [0, 0, 0, 0];
  let count = 0;
  for (let sy = box.y0; sy < box.y1; sy += 1) {
    for (let sx = box.x0; sx < box.x1; sx += 1) {
      const at = (sy * src.width + sx) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        sum[channel] = (sum[channel] ?? 0) + (src.data[at + channel] ?? 0);
      }
      count += 1;
    }
  }
  return sum.map((total) => Math.round(total / Math.max(1, count)));
}

function writePixel(dst: PNG, col: number, row: number, rgba: number[]): void {
  const at = (row * dst.width + col) * 4;
  for (let channel = 0; channel < 4; channel += 1) {
    dst.data[at + channel] = rgba[channel] ?? 0;
  }
}
