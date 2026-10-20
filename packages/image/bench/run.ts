/**
 * Benchmark the image engines on real screenshots.
 *
 *   nub run bench [-- <dir of NAME-light.png / NAME-dark.png pairs>]
 *
 * Needs the optional `sharp` peer. Prints Markdown tables of median milliseconds: PNG decode,
 * overlay encode, and the whole `diffImages` call, for a viewport-sized and a stacked full-page image.
 */
import { readdirSync } from "node:fs";
import { availableParallelism, cpus } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { ImageCodec, ImageEngine } from "../src/codec.ts";
import { loadCodec } from "../src/codecs.ts";
import { diffImages } from "../src/engine.ts";
import { DEFAULT_DIFF_OPTIONS } from "../src/options.ts";

const DIR = path.resolve(process.argv[2] ?? "../../apps/website/src/assets/screenshots");
const ENGINES: ImageEngine[] = ["pngjs", "sharp"];
const OPTIONS = { ...DEFAULT_DIFF_OPTIONS, maxDiffRatio: 0 };

interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

async function readRaw(file: string): Promise<Raw> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function stack(files: string[]): Promise<Raw> {
  const parts = await Promise.all(files.map(readRaw));
  return {
    data: Buffer.concat(parts.map((part) => part.data)),
    width: parts[0]?.width ?? 0,
    height: parts.reduce((sum, part) => sum + part.height, 0),
  };
}

async function toPng({ data, width, height }: Raw): Promise<Buffer> {
  return await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

/** +2 on ~3% of pixels: renderer noise, below the pixel threshold. */
function noisy(image: Raw): Raw {
  const data = Buffer.from(image.data);
  let seed = 12_345;
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    if (seed % 100 < 3) {
      for (let channel = 0; channel < 3; channel += 1) {
        data[pixel * 4 + channel] = Math.min(255, (data[pixel * 4 + channel] ?? 0) + 2);
      }
    }
  }
  return { ...image, data };
}

/** Invert a 300x60 block: a typical small visual change. */
function changed(image: Raw): Raw {
  const data = Buffer.from(image.data);
  for (let y = 300; y < 360; y += 1) {
    for (let x = 400; x < 700; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const at = (y * image.width + x) * 4 + channel;
        data[at] = 255 - (data[at] ?? 0);
      }
    }
  }
  return { ...image, data };
}

async function median(run: () => Promise<unknown>, iterations: number): Promise<number> {
  await run();
  await run();
  const times: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    // oxlint-disable-next-line eslint/no-await-in-loop -- timings must not overlap
    await run();
    times.push(performance.now() - start);
  }
  return times.toSorted((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0;
}

async function codecs(): Promise<Record<ImageEngine, ImageCodec>> {
  const [pngjs, sharpCodec] = await Promise.all([loadCodec("pngjs"), loadCodec("sharp")]);
  return { pngjs, sharp: sharpCodec };
}

function row(label: string, values: number[]): string {
  const [first = 1, second = 1] = values;
  return `| ${label} | ${values.map((value) => value.toFixed(0)).join(" | ")} | ${(first / second).toFixed(1)}x |`;
}

async function scenario(name: string, light: Raw, dark: Raw, iterations: number): Promise<void> {
  const loaded = await codecs();
  const base = await toPng(light);
  const cases: [string, Buffer][] = [
    ["noise only (should pass)", await toPng(noisy(light))],
    ["small change", await toPng(changed(light))],
    ["everything changed", await toPng(dark)],
  ];
  console.log(`\n### ${name} (${light.width}x${light.height})\n`);
  console.log(
    `| Step | ${ENGINES.join(" | ")} | speed-up |\n| --- | ${ENGINES.map(() => "---").join(" | ")} | --- |`,
  );
  const decode = await Promise.all(
    ENGINES.map(
      async (engine) => await median(async () => await loaded[engine].decode(base), iterations),
    ),
  );
  console.log(row("decode", decode));
  const image = await loaded.pngjs.decode(base);
  const encode = await Promise.all(
    ENGINES.map(
      async (engine) => await median(async () => await loaded[engine].encode(image), iterations),
    ),
  );
  console.log(row("encode overlay", encode));
  for (const [label, current] of cases) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- timings must not overlap
    const times = await Promise.all(
      ENGINES.map(
        async (engine) =>
          await median(
            async () => await diffImages(base, current, OPTIONS, loaded[engine]),
            iterations,
          ),
      ),
    );
    console.log(row(`diff: ${label}`, times));
  }
}

const names = readdirSync(DIR).filter((file) => file.endsWith("-light.png"));
const light = names.map((file) => path.join(DIR, file));
const dark = light.map((file) => file.replace("-light.png", "-dark.png"));
console.log(
  `CPU: ${cpus()[0]?.model} (${availableParallelism()} threads), Node ${process.version}, ${process.platform}-${process.arch}`,
);
console.log("Median ms; each engine runs one diff at a time.");
await scenario("Viewport", await readRaw(light[0] ?? ""), await readRaw(dark[0] ?? ""), 10);
await scenario("Full page", await stack(light), await stack(dark), 5);
