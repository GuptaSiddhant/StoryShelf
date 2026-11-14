import { makeStorage } from "@storyshelf/core/test-helpers";
import { publishedBrotliPath, publishedGzipPath, storybookDir } from "@storyshelf/core/utils";
import { createHash, randomBytes } from "node:crypto";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  MIN_PRECOMPRESS_BYTES,
  precompressBuild,
  settlePrecompression,
} from "./published-precompress.ts";

const hashOf = (data: Buffer): string => createHash("sha256").update(data).digest("hex");
const logger = { warn: vi.fn() } as never;

function seed(files: Record<string, Buffer>) {
  const { storage, objects } = makeStorage();
  const dir = storybookDir("p1", "b1");
  const manifest: Record<string, string> = {};
  for (const [rel, bytes] of Object.entries(files)) {
    const hash = hashOf(bytes);
    objects.set(`content/${hash}`, bytes);
    manifest[rel] = hash;
  }
  objects.set(`${dir}/manifest.json`, Buffer.from(JSON.stringify(manifest)));
  return { storage, objects, manifest };
}

describe("publish-time compressed copies", () => {
  it("writes verified gzip and brotli copies of compressible files above the threshold", async () => {
    const js = Buffer.from("export const x = 1;\n".repeat(500));
    const { storage, objects, manifest } = seed({ "main.js": js });
    precompressBuild(storage, "p1", "b1", logger);
    await settlePrecompression(storage);
    const hash = manifest["main.js"]!;
    expect(brotliDecompressSync(objects.get(publishedBrotliPath(hash))!)).toEqual(js);
    expect(gunzipSync(objects.get(publishedGzipPath(hash))!)).toEqual(js);
    expect(objects.get(`content/${hash}`)).toEqual(js);
  });

  it("skips tiny, binary and incompressible files", async () => {
    const tiny = Buffer.from("a".repeat(MIN_PRECOMPRESS_BYTES - 1));
    const png = randomBytes(4096);
    const noise = randomBytes(4096);
    const { storage, objects } = seed({ "tiny.js": tiny, "a.png": png, "noise.js": noise });
    precompressBuild(storage, "p1", "b1", logger);
    await settlePrecompression(storage);
    expect([...objects.keys()].filter((key) => key.startsWith("derived/"))).toEqual([]);
  });

  it("does nothing for a build without a manifest and is safe to repeat", async () => {
    const { storage, objects } = makeStorage();
    precompressBuild(storage, "p1", "gone", logger);
    await settlePrecompression(storage);
    expect(objects.size).toBe(0);
    const js = Buffer.from("const y = 2;\n".repeat(400));
    const seeded = seed({ "a.js": js });
    precompressBuild(seeded.storage, "p1", "b1", logger);
    precompressBuild(seeded.storage, "p1", "b1", logger);
    await settlePrecompression(seeded.storage);
    expect(seeded.objects.has(publishedBrotliPath(seeded.manifest["a.js"]!))).toBe(true);
  });

  it("logs a failure and keeps going", async () => {
    const js = Buffer.from("const z = 3;\n".repeat(400));
    const { storage } = seed({ "a.js": js });
    vi.spyOn(storage, "exists").mockRejectedValue(new Error("down"));
    const warn = vi.fn();
    precompressBuild(storage, "p1", "b1", { warn } as never);
    await settlePrecompression(storage);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
