import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runWithStore, type Store } from "../store.ts";
import { pngSizeOf, readPngSize } from "./png-size.ts";

/** A PNG signature plus an IHDR chunk header declaring `width`×`height` (enough for the reader). */
function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const storeWith = (readStream: (path: string) => Promise<Readable>): Store =>
  ({ storage: { readStream } }) as unknown as Store;

describe("pngSizeOf", () => {
  it("reads the width and height from the IHDR chunk", () => {
    expect(pngSizeOf(pngHeader(120, 100))).toEqual({ width: 120, height: 100 });
  });

  it("refuses bytes that are not a PNG header", () => {
    expect(pngSizeOf(Buffer.from("not a png at all, really not"))).toBeNull();
    expect(pngSizeOf(pngHeader(1, 1).subarray(0, 20))).toBeNull();
    const wrongChunk = pngHeader(5, 5);
    wrongChunk.write("IDAT", 12, "latin1");
    expect(pngSizeOf(wrongChunk)).toBeNull();
    expect(pngSizeOf(pngHeader(0, 10))).toBeNull();
  });
});

describe("readPngSize", () => {
  it("reads only the header, across chunks, and closes the stream", async () => {
    const header = pngHeader(100, 80);
    const stream = Readable.from([header.subarray(0, 10), header.subarray(10), Buffer.alloc(64)]);
    const destroy = vi.spyOn(stream, "destroy");
    const size = await runWithStore(
      storeWith(async () => stream),
      async () => await readPngSize("a.png"),
    );
    expect(size).toEqual({ width: 100, height: 80 });
    expect(destroy).toHaveBeenCalled();
  });

  it("answers null when the image is missing or truncated", async () => {
    const missing = storeWith(async () => {
      throw new Error("missing");
    });
    expect(await runWithStore(missing, async () => await readPngSize("a.png"))).toBeNull();
    const short = storeWith(async () => Readable.from([Buffer.alloc(4)]));
    expect(await runWithStore(short, async () => await readPngSize("a.png"))).toBeNull();
  });
});
