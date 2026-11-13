/** PNG fixtures for codec tests: the same picture in every colour type / bit depth / layout. */
import { crc32 } from "node:zlib";
import sharp, { type PngOptions } from "sharp";

export interface Fixture {
  name: string;
  png: Buffer;
}

const WIDTH = 64;
const HEIGHT = 48;

/** An RGBA gradient with a translucent corner, so channel order and alpha mistakes show up. */
function pixels(channels: 3 | 4): Buffer {
  const data = Buffer.alloc(WIDTH * HEIGHT * channels);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const at = (y * WIDTH + x) * channels;
      data[at] = (x * 4) % 256;
      data[at + 1] = (y * 5) % 256;
      data[at + 2] = ((x + y) * 3) % 256;
      if (channels === 4) {
        data[at + 3] = x < 8 && y < 8 ? 128 : 255;
      }
    }
  }
  return data;
}

/** Insert a `gAMA` chunk (gamma 1/2.2 scaled by 100000) right after IHDR. */
function withGamma(png: Buffer): Buffer {
  const body = Buffer.alloc(4);
  body.writeUInt32BE(45_455);
  const type = Buffer.from("gAMA");
  const chunk = Buffer.alloc(12 + 4);
  chunk.writeUInt32BE(4, 0);
  type.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, body])), 12);
  const ihdrEnd = 8 + 25;
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
}

async function encodeRaw(data: Buffer, channels: 3 | 4, options: PngOptions = {}): Promise<Buffer> {
  return await sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels } })
    .png(options)
    .toBuffer();
}

/** Colour types and layouts a screenshot pipeline can plausibly meet. */
export async function codecFixtures(): Promise<Fixture[]> {
  const rgba = await encodeRaw(pixels(4), 4);
  const rgb = await encodeRaw(pixels(3), 3);
  const grey = await sharp(pixels(3), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .greyscale()
    .png()
    .toBuffer();
  const wide = await sharp(pixels(3), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .toColourspace("rgb16")
    .png()
    .toBuffer();
  return [
    { name: "rgba", png: rgba },
    { name: "rgb", png: rgb },
    { name: "greyscale", png: grey },
    { name: "palette", png: await encodeRaw(pixels(3), 3, { palette: true, colours: 16 }) },
    { name: "interlaced", png: await encodeRaw(pixels(4), 4, { progressive: true }) },
    { name: "16-bit", png: wide },
    { name: "gamma chunk", png: withGamma(rgba) },
  ];
}

/** Same-sized RGBA pair differing in a small block. */
export async function changedPair(): Promise<{ baseline: Buffer; current: Buffer }> {
  const base = pixels(4);
  const changed = Buffer.from(base);
  for (let y = 10; y < 20; y += 1) {
    for (let x = 10; x < 30; x += 1) {
      changed[(y * WIDTH + x) * 4] = 255 - (changed[(y * WIDTH + x) * 4] ?? 0);
    }
  }
  return { baseline: await encodeRaw(base, 4), current: await encodeRaw(changed, 4) };
}
