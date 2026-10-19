// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
/* oxlint-disable */
/**
 * Phase 0 benchmark for the pixel diff engine (ADR 0031).
 *
 *   node scripts/bench-diff.mjs [--runs 15] [--dist]
 *
 * Generates deterministic UI-like PNGs at ~1280x720 and ~1280x4000 (no committed fixture
 * screenshots exist), then reports per-stage timings (PNG decode, pixelmatch, PNG encode),
 * whole-call `diffImages` timings and event-loop lag via a 5ms ticker plus `monitorEventLoopDelay`.
 * When the engine exports `diffImagesAsync` it is measured too (pooled, 4 in flight).
 *
 * --entry <file> imports any diff module (e.g. an older engine for before/after runs).
 * --dist imports the built `packages/core/dist/diff.mjs` instead of the TS source.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "packages/core");
const require = createRequire(join(core, "package.json"));
const pixelmatch = (await import(pathToFileURL(require.resolve("pixelmatch")).href)).default;
const { PNG } = require("pngjs");

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf("--runs") + 1]) || 15;
const entryArg = args[args.indexOf("--entry") + 1];
const entry = args.includes("--entry")
  ? entryArg
  : args.includes("--dist")
    ? join(core, "dist/diff.mjs")
    : join(core, "src/diff/index.ts");
const diff = await import(pathToFileURL(entry).href);
const OPTIONS = {
  pixelThreshold: 0.1,
  maxDiffRatio: 0.01,
  includeAntialiasing: false,
  failOnSizeChange: true,
};

/** Small deterministic PRNG so every run benchmarks identical bytes. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fill(png, x0, y0, w, h, [r, g, b]) {
  for (let y = y0; y < Math.min(y0 + h, png.height); y += 1) {
    for (let x = x0; x < Math.min(x0 + w, png.width); x += 1) {
      const i = (y * png.width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
}

/** White page with card rows, "text" bars and a gradient header: compresses like a real screenshot. */
function render(width, height, { shift = 0, block = 0 } = {}) {
  const png = new PNG({ width, height });
  const rand = rng(1234);
  fill(png, 0, 0, width, height, [255, 255, 255]);
  for (let x = 0; x < width; x += 1) {
    fill(png, x, 0, 1, 64, [40 + (x * 80) / width, 90, 200 - (x * 60) / width].map(Math.round));
  }
  for (let y = 88; y + 120 < height; y += 140) {
    fill(png, 32, y, width - 64, 120, [245, 247, 250]);
    for (let line = 0; line < 4; line += 1) {
      const w = Math.round(120 + rand() * (width - 360));
      fill(png, 56, y + 16 + line * 24, w, 10, [60 + Math.round(rand() * 40), 64, 72]);
    }
  }
  // The "change": move one card's first bar. Small, so the diff stays under typical thresholds.
  if (shift) {
    fill(png, 56, 104, 400 + shift, 10, [200, 40, 40]);
  }
  // A large block, so the diff exceeds maxDiffRatio and fails (the overlay then has to be encoded).
  if (block) {
    fill(png, 0, 64, width, Math.round(height * block), [20, 160, 60]);
  }
  return png;
}

const sizes = [
  { label: "1280x720", width: 1280, height: 720 },
  { label: "1280x4000", width: 1280, height: 4000 },
];

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const p95 = (xs) =>
  xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];
const ms = (n) => n.toFixed(1).padStart(8);

function timed(fn) {
  const t = performance.now();
  const out = fn();
  return [performance.now() - t, out];
}

function stageTimings(baseline, current) {
  const decode = [];
  const match = [];
  const encode = [];
  for (let i = 0; i < runs; i += 1) {
    const [d, [a, b]] = timed(() => [PNG.sync.read(baseline), PNG.sync.read(current)]);
    const out = new PNG({ width: a.width, height: a.height });
    const [m] = timed(() =>
      pixelmatch(a.data, b.data, out.data, a.width, a.height, {
        threshold: OPTIONS.pixelThreshold,
        includeAA: OPTIONS.includeAntialiasing,
      }),
    );
    const [e] = timed(() => PNG.sync.write(out));
    decode.push(d);
    match.push(m);
    encode.push(e);
  }
  return { decode: mean(decode), match: mean(match), encode: mean(encode) };
}

async function lagWhile(work) {
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  // A 5ms ticker: the longest gap between ticks is the longest the loop was unavailable
  // (what Playwright protocol traffic would see). The histogram only records once timers fire.
  let last = performance.now();
  let gapMax = 0;
  const ticker = setInterval(() => {
    const now = performance.now();
    gapMax = Math.max(gapMax, now - last);
    last = now;
  }, 5);
  const start = performance.now();
  await work();
  const wall = performance.now() - start;
  await new Promise((resolve) => setTimeout(resolve, 10));
  clearInterval(ticker);
  histogram.disable();
  return { wall, lagMax: gapMax, lagP99: histogram.percentile(99) / 1e6 };
}

console.log(`entry: ${entry}\nruns per case: ${runs}, node ${process.version}\n`);
for (const { label, width, height } of sizes) {
  const baseline = PNG.sync.write(render(width, height));
  const changed = PNG.sync.write(render(width, height, { shift: 120 }));
  const failing = PNG.sync.write(render(width, height, { block: 0.05 }));
  console.log(`== ${label}  (png ${(baseline.length / 1024).toFixed(0)} KiB) ==`);

  const s = stageTimings(baseline, changed);
  const total = s.decode + s.match + s.encode;
  console.log(
    `stages (ms)   decode x2 ${ms(s.decode)} (${((s.decode / total) * 100).toFixed(0)}%)` +
      `   pixelmatch ${ms(s.match)} (${((s.match / total) * 100).toFixed(0)}%)` +
      `   encode ${ms(s.encode)} (${((s.encode / total) * 100).toFixed(0)}%)`,
  );

  for (const [name, a, b] of [
    ["identical", baseline, Buffer.from(baseline)],
    ["changed", baseline, changed],
    ["failing", baseline, failing],
  ]) {
    const times = [];
    for (let i = 0; i < runs; i += 1) {
      times.push(timed(() => diff.diffImages(a, b, OPTIONS))[0]);
    }
    console.log(`diffImages ${name.padEnd(9)} mean ${ms(mean(times))}   p95 ${ms(p95(times))}`);
  }

  // 16 diffs, 4 in flight: the shape persistCapture produces. Lag = how long the loop stalls.
  const batch = Array.from({ length: 16 }, () => [baseline, failing]);
  const syncRun = await lagWhile(async () => {
    for (let i = 0; i < batch.length; i += 4) {
      await Promise.all(
        batch.slice(i, i + 4).map(async ([a, b]) => diff.diffImages(a, b, OPTIONS)),
      );
    }
  });
  console.log(
    `16 failing diffs sync  wall ${ms(syncRun.wall)}   longest stall ${ms(syncRun.lagMax)}  delay p99 ${ms(syncRun.lagP99)}`,
  );
  if (diff.diffImagesAsync) {
    // Copies: the pool transfers (detaches) the buffers it is given.
    const asyncRun = await lagWhile(async () => {
      for (let i = 0; i < batch.length; i += 4) {
        await Promise.all(
          batch
            .slice(i, i + 4)
            .map(async ([a, b]) => diff.diffImagesAsync(Buffer.from(a), Buffer.from(b), OPTIONS)),
        );
      }
    });
    console.log(
      `16 failing diffs async wall ${ms(asyncRun.wall)}   longest stall ${ms(asyncRun.lagMax)}  delay p99 ${ms(asyncRun.lagP99)}`,
    );
  }
  console.log();
}
await diff.shutdownDiffPool?.();
