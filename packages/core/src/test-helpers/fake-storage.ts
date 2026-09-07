import { Readable } from "node:stream";
import type { StorageAdapter } from "../adapters/storage.ts";

/** Storage and database doubles used by the capture pipeline tests. */
export interface FakeStorage {
  storage: StorageAdapter;
  objects: Map<string, Buffer>;
}

/** Create an in-memory storage adapter for capture pipeline tests. */
export function makeStorage(): FakeStorage {
  const objects = new Map<string, Buffer>();
  const storage: StorageAdapter = {
    metadata: { name: "Fake Storage", version: "0.0.0", kind: "memory", category: "storage" },
    read: async (path) => {
      const found = objects.get(path);
      if (found === undefined) {
        throw new Error(`no object at "${path}"`);
      }
      return await Promise.resolve(found);
    },
    write: async (path, data) => {
      objects.set(path, Buffer.from(data));
      await Promise.resolve();
    },
    delete: async (path) => {
      objects.delete(path);
      await Promise.resolve();
    },
    exists: async (path) => await Promise.resolve(objects.has(path)),
    list: async (prefix) =>
      await Promise.resolve([...objects.keys()].filter((key) => key.startsWith(prefix)).toSorted()),
    writeStream: async (path, stream) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(
          typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array),
        );
      }
      objects.set(path, Buffer.concat(chunks));
    },
    readStream: async (path) => {
      const found = objects.get(path);
      if (found === undefined) {
        throw new Error(`no object at "${path}"`);
      }
      return await Promise.resolve(Readable.from([found]));
    },
  };
  return { storage, objects };
}
