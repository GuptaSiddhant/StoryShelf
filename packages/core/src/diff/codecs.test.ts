import { describe, expect, it } from "vitest";
import type { ImageCodec } from "./codec.ts";
import { loadCodec } from "./codecs.ts";
import { codecFixtures } from "./test-fixtures.ts";

// 16-bit PNGs round to 8 bits differently (pngjs vs libvips): one level of 255, far under the
// diff threshold, and screenshots are 8-bit anyway. Every other layout must match exactly.
function allowedDelta(name: string): number {
  return name === "16-bit" ? 1 : 0;
}

function worstDelta(a: Uint8Array, b: Uint8Array): number {
  let worst = 0;
  for (const [index, value] of a.entries()) {
    worst = Math.max(worst, Math.abs(value - (b[index] ?? 0)));
  }
  return worst;
}

async function bothCodecs(): Promise<{ pngjs: ImageCodec; sharp: ImageCodec }> {
  return { pngjs: await loadCodec("pngjs"), sharp: await loadCodec("sharp") };
}

describe("loadCodec", () => {
  it("caches one codec per engine", async () => {
    expect(await loadCodec("pngjs")).toBe(await loadCodec("pngjs"));
    expect(await loadCodec("sharp")).toBe(await loadCodec("sharp"));
  });

  it("names its engine", async () => {
    const { pngjs, sharp } = await bothCodecs();
    expect([pngjs.name, sharp.name]).toEqual(["pngjs", "sharp"]);
  });
});

describe("codec parity: decode", async () => {
  const fixtures = await codecFixtures();
  it.each(fixtures.map((fixture) => [fixture.name, fixture.png] as const))(
    "decodes %s to the same RGBA on both engines",
    async (name, png) => {
      const { pngjs, sharp } = await bothCodecs();
      const a = await pngjs.decode(png);
      const b = await sharp.decode(png);
      expect([b.width, b.height]).toEqual([a.width, a.height]);
      expect(worstDelta(a.data, b.data)).toBeLessThanOrEqual(allowedDelta(name));
    },
  );
});

describe("codec parity: encode", () => {
  it("round-trips RGBA through each engine, and each engine reads the other's output", async () => {
    const { pngjs, sharp } = await bothCodecs();
    const [source] = await codecFixtures();
    const image = await pngjs.decode(source!.png);
    const encoded = await Promise.all([pngjs.encode(image), sharp.encode(image)]);
    const readers = [pngjs, sharp];
    const decoded = await Promise.all(
      encoded.flatMap((png) => readers.map(async (reader) => await reader.decode(png))),
    );
    for (const back of decoded) {
      expect(Buffer.from(back.data).equals(Buffer.from(image.data))).toBe(true);
    }
  });
});

describe("codec parity: downscale", () => {
  it.each([100, 32])("keeps the aspect ratio within %i px on both engines", async (maxEdge) => {
    const { pngjs, sharp } = await bothCodecs();
    const [source] = await codecFixtures();
    const outputs = await Promise.all(
      [pngjs, sharp].map(async (codec) => {
        const small = Buffer.from(await codec.downscale(source!.png, maxEdge));
        return await codec.decode(small);
      }),
    );
    for (const out of outputs) {
      expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(maxEdge);
      expect(out.width / out.height).toBeCloseTo(64 / 48, 1);
    }
  });
});
