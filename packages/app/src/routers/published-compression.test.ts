import { makeStorage } from "@storyshelf/core/test-helpers";
import { publishedGzipPath } from "@storyshelf/core/utils";
import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { acceptsGzip, publishedGzip } from "./published-compression.ts";

const hashOf = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

describe("published gzip variants", () => {
  it("negotiates gzip, respecting explicit refusal and invalid quality", () => {
    expect(acceptsGzip("br, gzip;q=0.5")).toBe(true);
    expect(acceptsGzip("*;q=1, gzip;q=0")).toBe(false);
    expect(acceptsGzip("gzip;q=2")).toBe(false);
    expect(acceptsGzip("gzip;q=abc")).toBe(false);
    expect(acceptsGzip()).toBe(false);
  });

  it("serves the original first and reuses a verified gzip variant", async () => {
    const { storage, objects } = makeStorage();
    const bytes = Buffer.from("storybook asset ".repeat(50_000));
    const hash = hashOf(bytes);
    objects.set(`content/${hash}`, bytes);
    expect(await publishedGzip(storage, hash, bytes, "application/javascript")).toBeUndefined();
    await vi.waitFor(() => expect(objects.has(publishedGzipPath(hash))).toBe(true), {
      timeout: 10_000,
    });
    const result = await publishedGzip(storage, hash, bytes, "application/javascript");
    expect(result).toBeDefined();
    expect(gunzipSync(result!)).toEqual(bytes);
    expect(objects.get(`content/${hash}`)).toEqual(bytes);
  }, 15_000);

  it("does not generate for legacy, oversized, binary or non-shrinking files", async () => {
    const { storage, objects } = makeStorage();
    const random = randomBytes(1024);
    const hash = hashOf(random);
    objects.set(`content/${hash}`, random);
    expect(await publishedGzip(storage, undefined, random, "text/plain")).toBeUndefined();
    expect(
      await publishedGzip(storage, hash, Buffer.alloc(8 * 1024 * 1024 + 1), "text/plain"),
    ).toBeUndefined();
    expect(await publishedGzip(storage, hash, random, "image/png")).toBeUndefined();
    expect(await publishedGzip(storage, hash, random, "text/plain")).toBeUndefined();
    await vi.waitFor(() => expect(storage.exists).toBeDefined());
    expect(objects.has(publishedGzipPath(hash))).toBe(false);
  });

  it.each([Buffer.from("partial"), gzipSync(Buffer.from("wrong".repeat(100)))])(
    "does not serve a corrupt or wrong-content variant and regenerates it",
    async (variant) => {
      const { storage, objects } = makeStorage();
      const bytes = Buffer.from("asset".repeat(1000));
      const hash = hashOf(bytes);
      objects.set(`content/${hash}`, bytes);
      objects.set(publishedGzipPath(hash), variant);
      expect(await publishedGzip(storage, hash, bytes, "text/plain")).toBeUndefined();
      await vi.waitFor(() =>
        expect(gunzipSync(objects.get(publishedGzipPath(hash))!)).toEqual(bytes),
      );
    },
  );

  it("returns the original if variant storage fails", async () => {
    const { storage, objects } = makeStorage();
    const bytes = Buffer.from("asset".repeat(1000));
    const hash = hashOf(bytes);
    objects.set(`content/${hash}`, bytes);
    const exists = storage.exists.bind(storage);
    storage.exists = async (key) =>
      key.startsWith("derived/") ? await Promise.reject(new Error("offline")) : await exists(key);
    storage.write = async () => await Promise.reject(new Error("offline"));
    await expect(publishedGzip(storage, hash, bytes, "text/plain")).resolves.toBeUndefined();
    expect(objects.get(`content/${hash}`)).toEqual(bytes);
  });

  it("coalesces a variant and refuses extra work when both job slots are occupied", async () => {
    const { storage, objects } = makeStorage();
    const files = ["one", "two", "three"].map((value) => Buffer.from(value.repeat(10_000)));
    for (const bytes of files) objects.set(`content/${hashOf(bytes)}`, bytes);
    const gate = Promise.withResolvers<null>();
    const write = vi.spyOn(storage, "write").mockImplementation(async () => {
      await gate.promise;
    });
    try {
      const first = files[0]!;
      await Promise.all(
        Array.from(
          { length: 5 },
          async () => await publishedGzip(storage, hashOf(first), first, "text/plain"),
        ),
      );
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      const second = files[1]!;
      await publishedGzip(storage, hashOf(second), second, "text/plain");
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
      const third = files[2]!;
      await publishedGzip(storage, hashOf(third), third, "text/plain");
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      gate.resolve(null);
    }
  });

  it("removes a variant if the source disappears while it is written", async () => {
    const { storage, objects } = makeStorage();
    const bytes = Buffer.from("asset".repeat(1000));
    const hash = hashOf(bytes);
    objects.set(`content/${hash}`, bytes);
    const write = storage.write.bind(storage);
    storage.write = async (key, data) => {
      await write(key, data);
      objects.delete(`content/${hash}`);
    };
    await publishedGzip(storage, hash, bytes, "text/plain");
    await vi.waitFor(() => expect(objects.has(`content/${hash}`)).toBe(false));
    await vi.waitFor(() => expect(objects.has(publishedGzipPath(hash))).toBe(false));
  });

  it("never serves a partial variant while a concurrent write is in progress", async () => {
    const { storage, objects } = makeStorage();
    const bytes = Buffer.from("asset".repeat(10_000));
    const hash = hashOf(bytes);
    const path = publishedGzipPath(hash);
    const gate = Promise.withResolvers<null>();
    objects.set(`content/${hash}`, bytes);
    storage.write = async (key, data) => {
      objects.set(key, data.subarray(0, 12));
      await gate.promise;
      objects.set(key, data);
    };
    try {
      await publishedGzip(storage, hash, bytes, "text/plain");
      await vi.waitFor(() => expect(objects.has(path)).toBe(true));
      expect(await publishedGzip(storage, hash, bytes, "text/plain")).toBeUndefined();
    } finally {
      gate.resolve(null);
    }
    await vi.waitFor(() => expect(gunzipSync(objects.get(path)!)).toEqual(bytes));
    expect(gunzipSync((await publishedGzip(storage, hash, bytes, "text/plain"))!)).toEqual(bytes);
  });
});
