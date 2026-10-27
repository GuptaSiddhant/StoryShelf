import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zipStream, type ZipSource } from "../../utils/zip-write.ts";
import { extractZipStream } from "./extract.ts";
import { ZipInvalidError } from "./invalid-zip.ts";
import { ZipLimitError } from "./limits.ts";

const LIMITS = { maxEntries: 100, maxBytes: 1024 * 1024 };

async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const sources: ZipSource[] = Object.entries(files).map(([name, data]) => ({
    name,
    data: Buffer.from(data),
  }));
  const chunks: Buffer[] = [];
  for await (const chunk of zipStream(sources)) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The zip as a stream of small chunks with no length known up front, like a chunked upload. */
function chunked(zip: Buffer, size = 64): Readable {
  const parts: Buffer[] = [];
  for (let at = 0; at < zip.length; at += size) {
    parts.push(zip.subarray(at, at + size));
  }
  return Readable.from(parts);
}

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "storyshelf-extract-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("extractZipStream", () => {
  it("extracts a zip streamed in chunks and reports what it counted", async () => {
    const zip = await zipOf({ "index.html": "<html></html>", "assets/app.js": "console.log(1)" });

    const result = await extractZipStream(chunked(zip), root, LIMITS);

    expect(result).toEqual({ entries: 2, bytes: "<html></html>".length + "console.log(1)".length });
    expect(await readFile(join(root, "assets", "app.js"), "utf8")).toBe("console.log(1)");
  });

  it("refuses an entry-count bomb", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i += 1) {
      files[`f${i}.txt`] = "x";
    }
    const zip = await zipOf(files);

    await expect(
      extractZipStream(chunked(zip), root, { maxEntries: 10, maxBytes: 1_000_000 }),
    ).rejects.toThrow(/more than 10 entries/u);
    expect((await readdir(root)).length).toBeLessThanOrEqual(10);
  });

  it("refuses a byte bomb while streaming, before the whole entry is written", async () => {
    const zip = await zipOf({ "big.bin": Buffer.alloc(2 * 1024 * 1024, 7) });

    const attempt = extractZipStream(chunked(zip, 4096), root, {
      maxEntries: 10,
      maxBytes: 64 * 1024,
    });

    await expect(attempt).rejects.toBeInstanceOf(ZipLimitError);
    await expect(attempt).rejects.toThrow(/expands beyond 65536 bytes/u);
  });

  it("counts bytes across entries, not per entry", async () => {
    const zip = await zipOf({ "a.bin": Buffer.alloc(600, 1), "b.bin": Buffer.alloc(600, 2) });

    await expect(
      extractZipStream(chunked(zip), root, { maxEntries: 10, maxBytes: 1000 }),
    ).rejects.toBeInstanceOf(ZipLimitError);
  });

  it.each([
    ["a parent traversal", "../escape.txt"],
    ["a nested traversal", "assets/../../escape.txt"],
    ["an absolute path", "/etc/escape.txt"],
    ["a drive path", "C:/escape.txt"],
  ])("refuses %s", async (_label, name) => {
    const zip = await zipOf({ "index.html": "ok", [name]: "evil" });

    const attempt = extractZipStream(chunked(zip), root, LIMITS);
    await expect(attempt).rejects.toThrow(/path traversal/u);
    await expect(readFile(join(root, "..", "escape.txt"))).rejects.toThrow();
  });

  it("rejects bytes that are not a zip", async () => {
    await expect(
      extractZipStream(Readable.from([Buffer.from("definitely-not-a-zip")]), root, LIMITS),
    ).rejects.toBeInstanceOf(ZipInvalidError);
  });
});
