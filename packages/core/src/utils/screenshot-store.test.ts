import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { makeStorage } from "../test-helpers/fake-adapters.ts";
import { contentDir, contentPath, isContentPath } from "./paths.ts";
import { storeScreenshot } from "./screenshot-store.ts";

const hashOf = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

describe("content paths", () => {
  it("builds a per-project path from the hash", () => {
    expect(contentDir("p1")).toBe("p1/content");
    expect(contentPath("p1", "abc123")).toBe("p1/content/abc123.png");
  });

  it("recognises only that project's content screenshots", () => {
    expect(isContentPath("p1", "p1/content/abc.png")).toBe(true);
    expect(isContentPath("p1", "p2/content/abc.png")).toBe(false);
    expect(isContentPath("p1", "p1/content/.sweep.json")).toBe(false);
    expect(isContentPath("p1", "p1/builds/b1/screenshots/a/desktop.png")).toBe(false);
  });

  it("rejects unsafe segments", () => {
    expect(() => contentPath("p1", "../x")).toThrow(/Unsafe/u);
    expect(() => contentPath("../p", "abc")).toThrow(/Unsafe/u);
  });
});

describe("storeScreenshot", () => {
  it("stores bytes under their hash and returns the path", async () => {
    const { storage, objects } = makeStorage();
    const data = Buffer.from("pixels");
    const path = await storeScreenshot(storage, "p1", data);
    expect(path).toBe(`p1/content/${hashOf(data)}.png`);
    expect(objects.get(path)).toEqual(data);
  });

  it("does not upload bytes it already has", async () => {
    const { storage } = makeStorage();
    const write = vi.spyOn(storage, "write");
    const data = Buffer.from("same");
    const first = await storeScreenshot(storage, "p1", data);
    const second = await storeScreenshot(storage, "p1", Buffer.from("same"));
    expect(second).toBe(first);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("keeps projects apart, and different bytes apart", async () => {
    const { storage } = makeStorage();
    const a = await storeScreenshot(storage, "p1", Buffer.from("a"));
    const b = await storeScreenshot(storage, "p1", Buffer.from("b"));
    const other = await storeScreenshot(storage, "p2", Buffer.from("a"));
    expect(new Set([a, b, other]).size).toBe(3);
    expect(other.startsWith("p2/content/")).toBe(true);
  });
});
