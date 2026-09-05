import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalStorage } from "./index.ts";

/** Collect a stream into a single buffer. */
async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

describe("createLocalStorage", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "storage-local-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes and reads a file", async () => {
    const storage = createLocalStorage(dir);
    await storage.write("a/b.txt", Buffer.from("hello"));
    const data = await storage.read("a/b.txt");
    expect(data.toString()).toBe("hello");
  });

  it("exists and delete round-trip", async () => {
    const storage = createLocalStorage(dir);
    expect(await storage.exists("a/b.txt")).toBe(false);
    await storage.write("a/b.txt", Buffer.from("hello"));
    expect(await storage.exists("a/b.txt")).toBe(true);
    await storage.delete("a/b.txt");
    expect(await storage.exists("a/b.txt")).toBe(false);
  });

  it("lists files recursively", async () => {
    const storage = createLocalStorage(dir);
    await storage.write("a/b.txt", Buffer.from("hello"));
    await storage.write("a/c.txt", Buffer.from("world"));
    const listA = await storage.list("a");
    expect(listA.toSorted()).toEqual(["a/b.txt", "a/c.txt"]);
  });

  it("lists the whole tree and missing prefixes", async () => {
    const storage = createLocalStorage(dir);
    await storage.write("a/b.txt", Buffer.from("hello"));
    await storage.write("d.txt", Buffer.from("top"));
    const all = await storage.list("");
    expect(all.toSorted()).toEqual(["a/b.txt", "d.txt"]);
    expect(await storage.list("missing")).toEqual([]);
  });

  it("rejects path traversal", async () => {
    const storage = createLocalStorage(dir);
    await expect(storage.write("../escape.txt", Buffer.from("x"))).rejects.toThrow();
    await expect(storage.read("../escape.txt")).rejects.toThrow();
  });

  it("writeStream/readStream round-trip bytes", async () => {
    const storage = createLocalStorage(dir);
    const payload = Buffer.from("streamed-bytes-".repeat(1000));
    await storage.writeStream("s/blob.bin", Readable.from([payload]));
    expect(await storage.exists("s/blob.bin")).toBe(true);
    expect(await collect(await storage.readStream("s/blob.bin"))).toEqual(payload);
    expect(await storage.read("s/blob.bin")).toEqual(payload);
  });

  it("readStream rejects for missing objects", async () => {
    const storage = createLocalStorage(dir);
    await expect(storage.readStream("missing.bin")).rejects.toThrow();
  });

  it("writeStream cleans up partial files on failure", async () => {
    const storage = createLocalStorage(dir);
    const failing = new Readable({
      read(): void {
        this.destroy(new Error("boom"));
      },
    });
    await expect(storage.writeStream("s/partial.bin", failing)).rejects.toThrow("boom");
    expect(await storage.exists("s/partial.bin")).toBe(false);
  });
});
