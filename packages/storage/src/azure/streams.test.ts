/** Streaming read/write tests for Azure Blob storage. */
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createAzureStorage } from "./index.ts";

interface BlobState {
  data?: Buffer;
  exists: boolean;
}

/** A fake ContainerClient that records calls and serves canned blob responses. */
function makeAzureClient(
  handlers: {
    download?: (name: string) => Promise<{ readableStreamBody?: unknown }>;
    downloadToBuffer?: (name: string) => Promise<Buffer>;
    upload?: (name: string, data: Buffer) => Promise<void>;
    uploadData?: (name: string, data: Buffer) => Promise<void>;
    exists?: (name: string) => Promise<boolean>;
    delete?: (name: string) => Promise<void>;
    deleteIfExists?: (name: string) => Promise<void>;
    uploadStream?: (name: string, stream: Readable) => Promise<void>;
    listBlobsFlat?: (opts?: { prefix?: string }) => AsyncIterable<{ name: string }>;
    containerExists?: () => Promise<boolean>;
  } = {},
): { client: unknown; blobs: Map<string, BlobState>; calls: string[] } {
  const calls: string[] = [];
  const blobs = new Map<string, BlobState>();

  function getState(name: string): BlobState {
    const existing = blobs.get(name);
    if (existing) {
      return existing;
    }
    const state: BlobState = { exists: false };
    blobs.set(name, state);
    return state;
  }

  const container = {
    getBlockBlobClient(name: string): unknown {
      const state = getState(name);
      return {
        download: async (): Promise<{ readableStreamBody?: unknown }> => {
          calls.push(`download:${name}`);
          if (handlers.download) {
            return await handlers.download(name);
          }
          if (state.data) {
            return { readableStreamBody: Readable.from([state.data]) };
          }
          return { readableStreamBody: undefined };
        },
        downloadToBuffer: handlers.downloadToBuffer
          ? async (): Promise<Buffer> => {
              calls.push(`downloadToBuffer:${name}`);
              return await handlers.downloadToBuffer!(name);
            }
          : undefined,
        upload: async (data: Buffer): Promise<void> => {
          calls.push(`upload:${name}`);
          if (handlers.upload) {
            await handlers.upload(name, data);
            return;
          }
          state.data = Buffer.from(data);
          state.exists = true;
        },
        uploadData: async (data: Buffer): Promise<void> => {
          calls.push(`uploadData:${name}`);
          if (handlers.uploadData) {
            await handlers.uploadData(name, data);
            return;
          }
          state.data = Buffer.from(data);
          state.exists = true;
        },
        exists: async (): Promise<boolean> => {
          calls.push(`exists:${name}`);
          if (handlers.exists) {
            return await handlers.exists(name);
          }
          return state.exists;
        },
        delete: async (): Promise<void> => {
          calls.push(`delete:${name}`);
          if (handlers.delete) {
            await handlers.delete(name);
            return;
          }
          blobs.delete(name);
        },
        deleteIfExists: handlers.deleteIfExists
          ? async (): Promise<void> => {
              calls.push(`deleteIfExists:${name}`);
              await handlers.deleteIfExists!(name);
            }
          : async (): Promise<void> => {
              calls.push(`deleteIfExists:${name}`);
              blobs.delete(name);
            },
        uploadStream: handlers.uploadStream
          ? async (stream: Readable): Promise<void> => {
              calls.push(`uploadStream:${name}`);
              await handlers.uploadStream!(name, stream);
            }
          : undefined,
      };
    },
    listBlobsFlat(opts?: { prefix?: string }): AsyncIterable<{ name: string }> {
      calls.push(`listBlobsFlat:${opts?.prefix ?? ""}`);
      if (handlers.listBlobsFlat) {
        return handlers.listBlobsFlat(opts);
      }
      const prefix = opts?.prefix ?? "";
      const items = [...blobs.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((name) => ({ name }));
      return {
        [Symbol.asyncIterator](): AsyncIterator<{ name: string }> {
          let index = 0;
          return {
            async next(): Promise<IteratorResult<{ name: string }>> {
              if (index < items.length) {
                const value = items[index]!;
                index += 1;
                return { value, done: false };
              }
              return { value: undefined as unknown as { name: string }, done: true };
            },
          };
        },
      };
    },
    exists: async (): Promise<boolean> => {
      calls.push("containerExists");
      if (handlers.containerExists) {
        return await handlers.containerExists();
      }
      return true;
    },
    listBlobsFlatWithMax: undefined,
  };

  // Adapter expects `listBlobsFlat` to be present; `exists` is optional fallback.
  return { client: container, blobs, calls };
}

describe("createAzureStorage - streams", () => {
  it("writeStream uploads via uploadStream when available", async () => {
    const { client, calls } = makeAzureClient({
      uploadStream: async (_name: string, stream: Readable): Promise<void> => {
        // consume stream to simulate upload
        const seen: unknown[] = [];
        for await (const chunk of stream) {
          seen.push(chunk);
        }
        expect(seen).toHaveLength(1);
      },
    });
    const storage = createAzureStorage({
      container: "bkt",
      prefix: "app",
      client: client as never,
    });

    await storage.writeStream("x/y.bin", Readable.from([Buffer.from("streamed")]));

    expect(calls).toEqual(expect.arrayContaining(["uploadStream:app/x/y.bin"]));
  });

  it("writeStream falls back to buffered upload when uploadStream absent", async () => {
    const { client, blobs } = makeAzureClient();
    const storage = createAzureStorage({ container: "bkt", client: client as never });

    await storage.writeStream("a.bin", Readable.from([Buffer.from("fallback")]));

    expect(blobs.get("a.bin")?.data).toEqual(Buffer.from("fallback"));
  });

  it("readStream returns a readable for existing blobs", async () => {
    const payload = Buffer.from("direct-bytes");
    const { client } = makeAzureClient({
      exists: async () => true,
      download: async () => ({ readableStreamBody: Readable.from([payload]) as never }),
    });
    const storage = createAzureStorage({ container: "bkt", client: client as never });

    const chunks: Buffer[] = [];
    for await (const chunk of await storage.readStream("a.bin")) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    expect(Buffer.concat(chunks)).toEqual(payload);
  });

  it("readStream rejects when the blob does not exist", async () => {
    const { client } = makeAzureClient({
      exists: async () => false,
    });
    const storage = createAzureStorage({ container: "bkt", client: client as never });

    await expect(storage.readStream("missing.bin")).rejects.toThrow();
  });
});
