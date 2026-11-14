import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCodec } from "./codecs.ts";
import { codecFixtures } from "./test-fixtures.ts";

describe("sharp codec", () => {
  it("decodes, re-encodes and downscales a PNG", async () => {
    const codec = await loadCodec("sharp");
    const [source] = await codecFixtures();
    const image = await codec.decode(source!.png);
    expect([image.width, image.height]).toEqual([64, 48]);
    const again = await codec.decode(await codec.encode(image));
    expect(Buffer.from(again.data).equals(Buffer.from(image.data))).toBe(true);
    const small = await codec.decode(Buffer.from(await codec.downscale(source!.png, 32)));
    expect([small.width, small.height]).toEqual([32, 24]);
  });

  it("copies the encoded overlay so a worker can transfer it", async () => {
    const codec = await loadCodec("sharp");
    const [source] = await codecFixtures();
    const png = await codec.encode(await codec.decode(source!.png));
    expect(png.buffer.byteLength).toBeGreaterThanOrEqual(png.byteLength);
    expect(png.buffer.constructor).toBe(ArrayBuffer);
  });

  it("rejects malformed PNGs like the default engine does", async () => {
    const codec = await loadCodec("sharp");
    await expect(Promise.resolve(codec.decode(Buffer.from("not a png")))).rejects.toThrow();
  });
});

async function createIn(isMainThread: boolean): Promise<ReturnType<typeof vi.fn>> {
  const concurrency = vi.fn();
  vi.resetModules();
  vi.doMock("sharp", () => ({ default: { concurrency } }));
  vi.doMock("node:worker_threads", () => ({ isMainThread }));
  const { createSharpCodec } = await import("./sharp.ts");
  await createSharpCodec();
  return concurrency;
}

describe("sharp codec thread cap", () => {
  afterEach(() => {
    vi.doUnmock("sharp");
    vi.doUnmock("node:worker_threads");
    vi.resetModules();
  });

  it("limits libvips to one thread inside a pool worker", async () => {
    expect(await createIn(false)).toHaveBeenCalledWith(1);
  });

  it("leaves libvips alone on the main thread", async () => {
    expect(await createIn(true)).not.toHaveBeenCalled();
  });
});
