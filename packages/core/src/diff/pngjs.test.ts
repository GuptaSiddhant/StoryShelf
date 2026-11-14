import { describe, expect, it } from "vitest";
import { pngjsCodec } from "./pngjs.ts";

function rgba(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (index * 7) % 256;
  }
  return data;
}

describe("pngjsCodec", () => {
  it("round-trips RGBA pixels", async () => {
    const data = rgba(8, 6);
    const decoded = await pngjsCodec.decode(await pngjsCodec.encode({ width: 8, height: 6, data }));
    expect([decoded.width, decoded.height]).toEqual([8, 6]);
    expect(Buffer.from(decoded.data).equals(Buffer.from(data))).toBe(true);
  });

  it("encodes a view into a larger buffer without reading its neighbours", async () => {
    const backing = new Uint8Array(8 * 6 * 4 + 100).fill(9);
    const view = backing.subarray(40, 40 + 8 * 6 * 4);
    view.set(rgba(8, 6));
    const decoded = await pngjsCodec.decode(
      await pngjsCodec.encode({ width: 8, height: 6, data: view }),
    );
    expect(Buffer.from(decoded.data).equals(Buffer.from(rgba(8, 6)))).toBe(true);
  });

  it("downscales to the long-edge limit", async () => {
    const png = await pngjsCodec.encode({ width: 200, height: 100, data: rgba(200, 100) });
    const small = await pngjsCodec.decode(Buffer.from(await pngjsCodec.downscale(png, 50)));
    expect([small.width, small.height]).toEqual([50, 25]);
  });
});
