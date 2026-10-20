import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureImages,
  DIFF_WORKERS_ENV,
  diffImagesAsync,
  resolveDiffWorkers,
  shutdownDiffPool,
} from "./async.ts";
import { diffImages } from "./engine.ts";
import { DEFAULT_DIFF_OPTIONS } from "./options.ts";
import { DiffPool } from "./pool.ts";

const WORKER_URL = new URL("worker.ts", import.meta.url);

function png(width: number, height: number, mark?: (x: number, y: number) => boolean): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) * 4;
      const hit = mark?.(x, y) ?? false;
      image.data[idx] = hit ? 0 : 255;
      image.data[idx + 1] = hit ? 0 : 255;
      image.data[idx + 2] = hit ? 255 : 255;
      image.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

const base = (): Buffer => png(40, 30);
const changed = (): Buffer => png(40, 30, (x, y) => x < 20 && y < 10);
const tolerated = (): Buffer => png(40, 30, (x, y) => x === 0 && y === 0);
const resized = (): Buffer => png(20, 15);

const pools: DiffPool[] = [];
function makePool(
  size: number,
  workerUrl: URL | string = WORKER_URL,
  engine?: "pngjs" | "sharp",
  onFallback: (reason: string) => void = () => {},
): DiffPool {
  const pool = new DiffPool({ size, workerUrl, engine, onFallback });
  pools.push(pool);
  return pool;
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map(async (pool) => await pool.shutdown()));
  await shutdownDiffPool();
  configureImages({});
  Reflect.deleteProperty(process.env, DIFF_WORKERS_ENV);
});

/** Wait until `ready()` holds, checking every few milliseconds. */
async function until(ready: () => boolean): Promise<void> {
  while (!ready()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- polling a condition
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** "diffed", or the message the diff was rejected with. */
async function settled(diff: Promise<unknown>): Promise<string> {
  return await diff.then(
    () => "diffed",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

const failOnResize = { ...DEFAULT_DIFF_OPTIONS };
const overlap = { ...DEFAULT_DIFF_OPTIONS, failOnSizeChange: false };
const lenient = { ...DEFAULT_DIFF_OPTIONS, maxDiffRatio: 0.5 };

describe("sync / pooled parity", () => {
  const cases: [string, () => [Buffer, Buffer], typeof failOnResize][] = [
    ["identical", () => [base(), base()], failOnResize],
    ["failing diff with overlay", () => [base(), changed()], failOnResize],
    ["tolerated diff, no overlay", () => [base(), tolerated()], lenient],
    ["size change fails", () => [base(), resized()], failOnResize],
    ["size change diffs the overlap", () => [base(), resized()], overlap],
  ];

  for (const [name, inputs, options] of cases) {
    it(`gives identical output for: ${name}`, async () => {
      const [a, b] = inputs();
      const expected = await diffImages(a, b, options);
      const pooled = await makePool(2).run(Buffer.from(a), Buffer.from(b), options);
      const inThread = await makePool(0).run(Buffer.from(a), Buffer.from(b), options);
      expect(pooled).toEqual(expected);
      expect(inThread).toEqual(expected);
      expect(Buffer.isBuffer(pooled.diffImage) || pooled.diffImage === null).toBe(true);
    });
  }

  it("runs many concurrent diffs across a small pool", async () => {
    const pool = makePool(2);
    const expected = await diffImages(base(), changed(), failOnResize);
    const results = await Promise.all(
      Array.from({ length: 12 }, async () => await pool.run(base(), changed(), failOnResize)),
    );
    expect(results.every((result) => result.diffPixels === expected.diffPixels)).toBe(true);
    expect(pool.workerCount).toBeLessThanOrEqual(2);
  });

  it("copies pooled Buffer slices instead of detaching shared memory", async () => {
    const pooled = Buffer.from(base()); // may live in the shared 8 KiB Buffer pool
    const sibling = Buffer.from("untouched");
    await makePool(1).run(pooled, Buffer.from(changed()), failOnResize);
    expect(sibling.toString()).toBe("untouched");
  });

  it("diffImagesAsync matches diffImages", async () => {
    expect(await diffImagesAsync(base(), changed(), failOnResize)).toEqual(
      await diffImages(base(), changed(), failOnResize),
    );
  });
});

describe("DiffPool failure modes", () => {
  it("propagates a task error without losing the worker", async () => {
    const pool = makePool(1);
    const junk = Buffer.alloc(64, 7);
    await expect(pool.run(junk, base(), failOnResize)).rejects.toThrow();
    expect(await pool.run(base(), changed(), failOnResize)).toEqual(
      await diffImages(base(), changed(), failOnResize),
    );
    expect(pool.workerCount).toBe(1);
  });

  it("rejects the in-flight task when a worker crashes, then recovers", async () => {
    // A worker that reports ready, then dies on its first request.
    const crashing = `data:text/javascript,${encodeURIComponent(
      `import { parentPort } from "node:worker_threads";
       parentPort.on("message", () => process.exit(3));
       parentPort.postMessage({ type: "ready" });`,
    )}`;
    const pool = makePool(1, new URL(crashing));
    await expect(pool.run(base(), changed(), failOnResize)).rejects.toThrow(/exited with code 3/u);
    expect(pool.workerCount).toBe(0);
  });

  it("falls back in-thread when the worker file fails to load", async () => {
    const pool = makePool(2, new URL("does-not-exist.mjs", import.meta.url));
    const results = await Promise.all([
      pool.run(base(), changed(), failOnResize),
      pool.run(base(), changed(), failOnResize),
    ]);
    const expected = await diffImages(base(), changed(), failOnResize);
    expect(results).toEqual([expected, expected]);
    // The pool stays in-thread for later calls and keeps no workers.
    expect(await pool.run(base(), changed(), failOnResize)).toEqual(expected);
    expect(pool.workerCount).toBe(0);
  });

  it("warns once when it falls back in-thread", async () => {
    const onFallback = vi.fn();
    const pool = makePool(2, new URL("does-not-exist.mjs", import.meta.url), "pngjs", onFallback);
    await Promise.all([
      pool.run(base(), changed(), failOnResize),
      pool.run(base(), changed(), failOnResize),
    ]);
    await pool.run(base(), changed(), failOnResize);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0]?.[0]).toMatch(/before it was ready/u);
  });

  it("keeps a running diff when a later worker dies before it is ready", async () => {
    // The first worker starts fine and answers slowly; every later one dies during start-up.
    const dir = mkdtempSync(join(tmpdir(), "storyshelf-pool-"));
    const marker = JSON.stringify(join(dir, "first"));
    const busy = join(dir, "busy");
    const flaky = `data:text/javascript,${encodeURIComponent(
      `import { closeSync, openSync } from "node:fs";
       import { parentPort } from "node:worker_threads";
       let first = false;
       try { closeSync(openSync(${marker}, "wx")); first = true; } catch {}
       if (first) {
         parentPort.on("message", (req) => {
           closeSync(openSync(${JSON.stringify(busy)}, "w"));
           setTimeout(() => parentPort.postMessage(
             { type: "error", id: req.id, name: "Error", message: "answered" }), 300);
         });
         parentPort.postMessage({ type: "ready" });
       } else {
         setTimeout(() => process.exit(9), 20);
       }`,
    )}`;
    const onFallback = vi.fn();
    const pool = makePool(2, new URL(flaky), "pngjs", onFallback);
    try {
      const first = settled(pool.run(base(), changed(), failOnResize));
      await until(() => existsSync(busy)); // the first worker has the diff
      // Its start-up kills the next workers; the diff runs in-thread or on the first worker.
      const second = settled(pool.run(base(), changed(), failOnResize));
      // Without the fix the fallback terminated the busy worker and this never settled.
      expect(await first).toBe("answered");
      expect(["diffed", "answered"]).toContain(await second);
      expect(onFallback.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shuts down cleanly: rejects pending work and terminates workers", async () => {
    const pool = makePool(1);
    const pending = pool.run(base(), changed(), failOnResize);
    const rejected = expect(pending).rejects.toThrow(/shut down/u);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let it queue behind worker start-up
    await pool.shutdown();
    await rejected;
    expect(pool.workerCount).toBe(0);
    // Usable again afterwards.
    expect((await pool.run(base(), changed(), failOnResize)).passed).toBe(false);
  });

  it("skips workers entirely for byte-equal inputs", async () => {
    const pool = makePool(2);
    const a = base();
    const result = await pool.run(a, Buffer.from(a), failOnResize);
    expect(result.passed).toBe(true);
    expect(pool.workerCount).toBe(0);
  });
});

describe("worker count", () => {
  it("defaults to one fewer than the CPU count, at least one", () => {
    expect(resolveDiffWorkers({}, 8)).toBe(7);
    expect(resolveDiffWorkers({}, 1)).toBe(1);
  });

  it("honours STORYSHELF_DIFF_WORKERS, including 0, and ignores junk", () => {
    expect(resolveDiffWorkers({ [DIFF_WORKERS_ENV]: "3" }, 8)).toBe(3);
    expect(resolveDiffWorkers({ [DIFF_WORKERS_ENV]: "0" }, 8)).toBe(0);
    expect(resolveDiffWorkers({ [DIFF_WORKERS_ENV]: "-1" }, 8)).toBe(7);
    expect(resolveDiffWorkers({ [DIFF_WORKERS_ENV]: "abc" }, 8)).toBe(7);
  });

  it("STORYSHELF_DIFF_WORKERS=0 runs diffImagesAsync in-thread", async () => {
    process.env[DIFF_WORKERS_ENV] = "0";
    expect(await diffImagesAsync(base(), changed(), failOnResize)).toEqual(
      await diffImages(base(), changed(), failOnResize),
    );
  });

  it("compare.threads beats STORYSHELF_DIFF_WORKERS and can be changed at runtime", async () => {
    process.env[DIFF_WORKERS_ENV] = "3";
    configureImages({ threads: 0 });
    expect(await diffImagesAsync(base(), changed(), failOnResize)).toEqual(
      await diffImages(base(), changed(), failOnResize),
    );
    // Reconfiguring replaces the pool; it still produces the same result.
    configureImages({ threads: 1 });
    expect(await diffImagesAsync(base(), changed(), failOnResize)).toEqual(
      await diffImages(base(), changed(), failOnResize),
    );
  });
});

describe("sharp engine", () => {
  it("diffs in workers and in-thread with the same verdict as pngjs", async () => {
    const expected = await diffImages(base(), changed(), failOnResize);
    const inWorker = await makePool(1, WORKER_URL, "sharp").run(base(), changed(), failOnResize);
    const inThread = await makePool(0, WORKER_URL, "sharp").run(base(), changed(), failOnResize);
    for (const result of [inWorker, inThread]) {
      expect({ ...result, diffImage: null }).toEqual({ ...expected, diffImage: null });
      expect(result.diffImage).not.toBeNull();
      expect(
        PNG.sync
          .read(Buffer.from(result.diffImage!))
          .data.equals(PNG.sync.read(expected.diffImage!).data),
      ).toBe(true);
    }
  });

  it("applies images.engine from configureImages to the shared pool", async () => {
    configureImages({ engine: "sharp", threads: 1 });
    const result = await diffImagesAsync(base(), changed(), failOnResize);
    expect(result.passed).toBe(false);
    expect(result.diffPixels).toBe(200);
  });
});
