import { describe, expect, it } from "vitest";
import { makeStorage } from "../test-helpers/fake-storage.ts";
import { publishedGzipPath } from "../utils/paths.ts";
import { sweepPublishedGzip } from "./published-gzip-sweep.ts";

describe("published gzip cleanup", () => {
  it("removes orphan variants without touching source content or other keys", async () => {
    const { storage, objects } = makeStorage();
    const live = "a".repeat(64);
    const dead = "b".repeat(64);
    objects.set(`content/${live}`, Buffer.from("original"));
    objects.set(publishedGzipPath(live), Buffer.from("live"));
    objects.set(publishedGzipPath(dead), Buffer.from("dead"));
    objects.set("derived/published-gzip/unrelated", Buffer.from("other"));
    await sweepPublishedGzip(storage);
    expect(objects.has(publishedGzipPath(dead))).toBe(false);
    expect(objects.get(`content/${live}`)?.toString()).toBe("original");
    expect(objects.has(publishedGzipPath(live))).toBe(true);
    expect(objects.has("derived/published-gzip/unrelated")).toBe(true);
  });

  it("advances through a bounded batch without starving later keys", async () => {
    const { storage, objects } = makeStorage();
    for (let index = 0; index < 129; index += 1) {
      const hash = index.toString(16).padStart(64, "0");
      objects.set(`content/${hash}`, Buffer.from("original"));
      objects.set(publishedGzipPath(hash), Buffer.from("variant"));
    }
    const last = (128).toString(16).padStart(64, "0");
    objects.delete(`content/${last}`);
    await sweepPublishedGzip(storage);
    expect(objects.has(publishedGzipPath(last))).toBe(true);
    await sweepPublishedGzip(storage);
    expect(objects.has(publishedGzipPath(last))).toBe(false);
  });
});
