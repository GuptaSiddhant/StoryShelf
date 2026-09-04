import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalStorage } from "./index.ts";

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
});
