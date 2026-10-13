import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { zipStream, type ZipSource } from "./zip-write.ts";

async function collect(chunks: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of chunks) {
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

const source = (name: string, text: string): ZipSource => ({
  name,
  data: async () => Buffer.from(text),
});

describe("zipStream", () => {
  it("writes an archive standard tools can read", async () => {
    const archive = await collect(
      zipStream([source("a.txt", "alpha"), source("dir/b.txt", "beta"), source("é.txt", "")]),
    );
    const zip = new AdmZip(archive);
    expect(zip.getEntries().map((entry) => entry.entryName)).toEqual([
      "a.txt",
      "dir/b.txt",
      "é.txt",
    ]);
    expect(String(zip.readFile("dir/b.txt"))).toBe("beta");
    expect(String(zip.readFile("é.txt"))).toBe("");
  });

  it("is byte-reproducible", async () => {
    const first = await collect(zipStream([source("a.txt", "alpha")]));
    const second = await collect(zipStream([source("a.txt", "alpha")]));
    expect(first.equals(second)).toBe(true);
  });

  it("writes a valid empty archive", async () => {
    const archive = await collect(zipStream([]));
    expect(archive.length).toBe(22);
    expect(new AdmZip(archive).getEntries()).toEqual([]);
  });

  it("reads sources lazily, one at a time", async () => {
    const order: string[] = [];
    async function* sources(): AsyncGenerator<ZipSource> {
      for (const name of ["one", "two"]) {
        order.push(`yield:${name}`);
        yield {
          name,
          data: async () => {
            order.push(`read:${name}`);
            return Buffer.from(name);
          },
        };
      }
    }
    await collect(zipStream(sources()));
    expect(order).toEqual(["yield:one", "read:one", "yield:two", "read:two"]);
  });

  it("refuses archives that need zip64", async () => {
    const many = Array.from({ length: 65_536 }, (_unused, index) => source(`${index}`, ""));
    await expect(collect(zipStream(many))).rejects.toThrow(/65535 entries/u);
  });
});
