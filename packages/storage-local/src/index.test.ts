import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalStorage } from "./index.ts";

/** When set, the next `writeFile` writes only a prefix of its data and then fails, like a kill. */
const torn = vi.hoisted(() => ({ next: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (!torn.next) {
        return await actual.writeFile(...args);
      }
      torn.next = false;
      await actual.writeFile(args[0], (args[1] as Buffer).subarray(0, 2));
      throw new Error("killed");
    },
  };
});

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

  it("never leaves a torn file at the path when a write is cut short", async () => {
    const storage = createLocalStorage(dir);
    torn.next = true;
    await expect(storage.write("c/new.png", Buffer.from("complete"))).rejects.toThrow("killed");
    expect(await storage.exists("c/new.png")).toBe(false);

    await storage.write("c/old.png", Buffer.from("original"));
    torn.next = true;
    await expect(storage.write("c/old.png", Buffer.from("replacement"))).rejects.toThrow("killed");
    expect((await storage.read("c/old.png")).toString()).toBe("original");
    expect(await readdir(join(dir, "c"))).toEqual(["old.png"]);
  });

  it("lists exactly the keys it was given to write", async () => {
    const storage = createLocalStorage(dir);
    const keys = ["p1/content/a.png", "p1/content/.claims/x.json", "p1/builds/b1/s/desktop.png"];
    await Promise.all(keys.map(async (key) => await storage.write(key, Buffer.from(key))));
    expect((await storage.list("p1/")).toSorted()).toEqual(keys.toSorted());
    expect(await storage.list("p1/content/")).toEqual(
      expect.arrayContaining(["p1/content/a.png", "p1/content/.claims/x.json"]),
    );
  });

  it("exposes local storage metadata", () => {
    const storage = createLocalStorage(dir);
    expect(storage.metadata.kind).toBe("local");
    expect(storage.metadata.category).toBe("storage");
  });

  it("lifecycle setup is idempotent and health reflects root presence", async () => {
    const storage = createLocalStorage(dir);
    await storage.lifecycle?.setup?.({} as never);
    await storage.lifecycle?.setup?.({} as never);
    await expect(storage.lifecycle?.health?.()).resolves.toEqual({ ok: true });

    await rm(dir, { recursive: true, force: true });
    await expect(storage.lifecycle?.health?.()).resolves.toEqual({ ok: false });

    await storage.lifecycle?.setup?.({} as never);
    await expect(storage.lifecycle?.health?.()).resolves.toEqual({ ok: true });
  });

  it("lifecycle teardown is a repeatable no-op", async () => {
    const storage = createLocalStorage(dir);
    await storage.lifecycle?.teardown?.();
    await expect(storage.lifecycle?.teardown?.()).resolves.toBeUndefined();
  });
});
