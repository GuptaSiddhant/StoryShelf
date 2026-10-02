/**
 * Published storage contract suite for first- and third-party adapters.
 *
 * A package proves conformance in one line from its own vitest file:
 *
 * ```ts
 * import { storageContractSuite } from "@storyshelf/core/test-helpers";
 * storageContractSuite("local", () => createLocalStorage(mkdtempSync(...)));
 * ```
 *
 * Every case uses an isolated `__contract__/` prefix so suites can share one
 * adapter instance. Fakes the transport (temp dirs, fake clients) — never
 * the adapter itself.
 */
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { StorageAdapter } from "../adapters/storage.ts";

/** Build the adapter under test (sync or async factories both work). */
export type StorageFactory = () => StorageAdapter | Promise<StorageAdapter>;

/** Collect a stream into a single buffer. */
async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** Run the full storage contract against a factory. */
export function storageContractSuite(label: string, make: StorageFactory): void {
  const prefix = `__contract__/${label}`;
  describe(`storage contract: ${label}`, () => {
    it("exposes storage metadata", async () => {
      const adapter = await make();
      expect(adapter.metadata.category).toBe("storage");
      expect(adapter.metadata.kind.length).toBeGreaterThan(0);
    });

    it("keeps lifecycle idempotent", async () => {
      const adapter = await make();
      await adapter.lifecycle?.setup?.({} as never);
      await adapter.lifecycle?.setup?.({} as never);
      await expect(adapter.lifecycle?.health?.()).resolves.toMatchObject({ ok: true });
      await adapter.lifecycle?.teardown?.();
      await expect(adapter.lifecycle?.teardown?.()).resolves.toBeUndefined();
    });

    it("round-trips write/read/exists/delete", async () => {
      const adapter = await make();
      const path = `${prefix}/roundtrip.txt`;
      expect(await adapter.exists(path)).toBe(false);
      await adapter.write(path, Buffer.from("hello"));
      expect(await adapter.exists(path)).toBe(true);
      expect((await adapter.read(path)).toString()).toBe("hello");
      await adapter.delete(path);
      expect(await adapter.exists(path)).toBe(false);
    });

    it("lists recursively and empty for missing prefixes", async () => {
      const adapter = await make();
      await adapter.write(`${prefix}/list/a.txt`, Buffer.from("a"));
      await adapter.write(`${prefix}/list/b.txt`, Buffer.from("b"));
      expect((await adapter.list(`${prefix}/list`)).toSorted()).toEqual([
        `${prefix}/list/a.txt`,
        `${prefix}/list/b.txt`,
      ]);
      expect(await adapter.list(`${prefix}/missing`)).toEqual([]);
    });

    it("rejects missing reads", async () => {
      const adapter = await make();
      await expect(adapter.read(`${prefix}/nope.bin`)).rejects.toThrow();
      await expect(adapter.readStream(`${prefix}/nope.bin`)).rejects.toThrow();
    });

    it("streams bytes identically and cleans partial writes", async () => {
      const adapter = await make();
      const payload = Buffer.from("streamed-".repeat(500));
      const path = `${prefix}/stream/blob.bin`;
      await adapter.writeStream(path, Readable.from([payload]));
      expect(await collect(await adapter.readStream(path))).toEqual(payload);
      const failing = new Readable({
        read(): void {
          this.destroy(new Error("boom"));
        },
      });
      await expect(adapter.writeStream(`${prefix}/stream/partial.bin`, failing)).rejects.toThrow(
        "boom",
      );
      expect(await adapter.exists(`${prefix}/stream/partial.bin`)).toBe(false);
    });
  });
}
