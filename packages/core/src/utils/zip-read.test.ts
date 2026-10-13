import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { isUnsafeEntryName, readZip, ZipFormatError, type ZipReadLimits } from "./zip-read.ts";
import { zipStream } from "./zip-write.ts";

const LIMITS: ZipReadLimits = { maxEntries: 10, maxEntryBytes: 1024, maxTotalBytes: 4096 };

async function stored(files: Record<string, string>): Promise<Buffer> {
  const parts: Buffer[] = [];
  const sources = Object.entries(files).map(([name, text]) => ({
    name,
    data: async () => Buffer.from(text),
  }));
  for await (const chunk of zipStream(sources)) {
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

describe("readZip", () => {
  it("reads stored entries", async () => {
    const entries = readZip(await stored({ "a.txt": "alpha", "b/c.txt": "gamma" }), LIMITS);
    expect([...entries.keys()]).toEqual(["a.txt", "b/c.txt"]);
    expect(entries.get("b/c.txt")?.read().toString()).toBe("gamma");
  });

  it("reads deflated entries and skips directories", () => {
    const zip = new AdmZip();
    zip.addFile("dir/", Buffer.alloc(0));
    zip.addFile("dir/text.txt", Buffer.from("x".repeat(500)));
    const entries = readZip(zip.toBuffer(), LIMITS);
    expect([...entries.keys()]).toEqual(["dir/text.txt"]);
    expect(entries.get("dir/text.txt")?.read().toString()).toBe("x".repeat(500));
  });

  it.each(["../evil.png", "/abs.png", "a/../../b", "a\\b", "C:/x", "./a", "a/./b", ""])(
    "rejects the unsafe entry name %j",
    async (name) => {
      expect(isUnsafeEntryName(name)).toBe(true);
      await expect(stored({ [name]: "x" }).then((zip) => readZip(zip, LIMITS))).rejects.toThrow(
        ZipFormatError,
      );
    },
  );

  it("accepts ordinary nested names", () => {
    expect(isUnsafeEntryName("baselines/feature/x/story--a/desktop.png")).toBe(false);
  });

  it("enforces the entry-count limit", async () => {
    const files = Object.fromEntries(Array.from({ length: 11 }, (_unused, i) => [`${i}.txt`, "x"]));
    expect(() => readZip(Buffer.alloc(0), LIMITS)).toThrow(/Not a zip/u);
    await expect(stored(files).then((zip) => readZip(zip, LIMITS))).rejects.toThrow(/entries/u);
  });

  it("enforces per-entry and total size limits before inflating", () => {
    const bomb = new AdmZip();
    bomb.addFile("big.txt", Buffer.alloc(2048));
    expect(() => readZip(bomb.toBuffer(), LIMITS)).toThrow(/exceeds 1024 bytes/u);
    const wide = new AdmZip();
    for (let index = 0; index < 5; index += 1) {
      wide.addFile(`${index}.txt`, Buffer.alloc(1000));
    }
    expect(() => readZip(wide.toBuffer(), LIMITS)).toThrow(/expands beyond 4096/u);
  });

  it("rejects corrupted data and duplicates", async () => {
    const archive = await stored({ "a.txt": "alpha" });
    const corrupted = Buffer.from(archive);
    corrupted[30 + "a.txt".length] = "X".codePointAt(0) ?? 0;
    expect(() => readZip(corrupted, LIMITS).get("a.txt")?.read()).toThrow(/integrity/u);
    const parts: Buffer[] = [];
    const twice = ["a.txt", "a.txt"].map((name) => ({ name, data: async () => Buffer.from("1") }));
    for await (const chunk of zipStream(twice)) {
      parts.push(chunk);
    }
    expect(() => readZip(Buffer.concat(parts), LIMITS)).toThrow(/Duplicate/u);
  });

  it("rejects truncated archives", async () => {
    const archive = await stored({ "a.txt": "alpha" });
    const end = archive.subarray(-22);
    expect(() => readZip(Buffer.concat([Buffer.alloc(4), end]), LIMITS)).toThrow(ZipFormatError);
  });

  it("rejects encrypted entries and unknown methods", async () => {
    const archive = await stored({ "a.txt": "alpha" });
    const central = archive.length - 22 - (46 + "a.txt".length);
    const encrypted = Buffer.from(archive);
    encrypted.writeUInt16LE(0x08_01, central + 8);
    expect(() => readZip(encrypted, LIMITS)).toThrow(/Encrypted/u);
    const lzma = Buffer.from(archive);
    lzma.writeUInt16LE(14, central + 10);
    expect(() => readZip(lzma, LIMITS)).toThrow(/compression method 14/u);
  });

  it("rejects multi-disk archives", async () => {
    const archive = Buffer.from(await stored({ "a.txt": "alpha" }));
    archive.writeUInt16LE(1, archive.length - 22 + 4);
    expect(() => readZip(archive, LIMITS)).toThrow(/Multi-disk/u);
  });
});
