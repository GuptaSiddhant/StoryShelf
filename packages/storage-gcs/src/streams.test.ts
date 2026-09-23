import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createGcsStorage } from "./index.ts";

function makeGcsClient(
  handlers: {
    exists?: (name: string) => Promise<[boolean]>;
    delete?: (name: string) => Promise<void>;
    createWriteStream?: (name: string) => NodeJS.WritableStream;
    createReadStream?: (name: string) => Readable;
    downloadResult?: Buffer;
  } = {},
): { client: unknown; calls: string[] } {
  const calls: string[] = [];

  type FakeBucket = {
    file: (name: string) => {
      save: (data: Buffer) => Promise<void>;
      exists: () => Promise<[boolean]>;
      delete: () => Promise<void>;
      createWriteStream: () => NodeJS.WritableStream;
      createReadStream: () => Readable;
    };
  };

  const bucket: FakeBucket = {
    file(name: string) {
      return {
        save: async (): Promise<void> => {
          calls.push(`save:${name}`);
        },
        exists: async (): Promise<[boolean]> => {
          calls.push(`exists:${name}`);
          if (handlers.exists) {
            return await handlers.exists(name);
          }
          return [false];
        },
        delete: async (): Promise<void> => {
          calls.push(`delete:${name}`);
          if (handlers.delete) {
            await handlers.delete(name);
          }
        },
        createWriteStream: (): NodeJS.WritableStream => {
          calls.push(`createWriteStream:${name}`);
          if (handlers.createWriteStream) {
            return handlers.createWriteStream(name);
          }
          return new Writable({
            write(_chunk: Buffer, _encoding: string, callback: () => void): void {
              callback();
            },
          });
        },
        createReadStream: (): Readable => {
          calls.push(`createReadStream:${name}`);
          if (handlers.createReadStream) {
            return handlers.createReadStream(name);
          }
          return Readable.from([handlers.downloadResult ?? Buffer.alloc(0)]);
        },
      };
    },
  };

  return { client: { bucket: (): FakeBucket => bucket }, calls };
}

describe("createGcsStorage - streams", () => {
  it("writeStream pipelines bytes to the GCS file", async () => {
    const { client, calls } = makeGcsClient();
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });

    await storage.writeStream("x/y.bin", Readable.from([Buffer.from("streamed")]));

    expect(calls).toEqual(expect.arrayContaining(["createWriteStream:app/x/y.bin"]));
  });

  it("writeStream deletes the partial object when the pipeline fails", async () => {
    const { client, calls } = makeGcsClient({
      createWriteStream: (): NodeJS.WritableStream =>
        new Writable({
          write(_chunk, _encoding, callback): void {
            callback(new Error("boom"));
          },
        }),
    });
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });
    const source = Readable.from([Buffer.from("streamed")]);

    await expect(storage.writeStream("x/y.bin", source)).rejects.toThrow("boom");

    expect(calls).toEqual(expect.arrayContaining(["delete:app/x/y.bin"]));
  });

  it("readStream returns a readable for existing objects", async () => {
    const payload = Buffer.from("direct-bytes");
    const { client } = makeGcsClient({
      exists: async () => [true],
      createReadStream: () => Readable.from([payload]),
    });
    const storage = createGcsStorage({ bucket: "bkt", client: client as never });

    const chunks: Buffer[] = [];
    for await (const chunk of await storage.readStream("a.bin")) {
      const bytes = Buffer.from(chunk as Uint8Array);
      chunks.push(bytes);
    }
    expect(Buffer.concat(chunks)).toEqual(payload);
  });

  it("readStream rejects when the object does not exist", async () => {
    const { client } = makeGcsClient({
      exists: async () => [false],
    });
    const storage = createGcsStorage({ bucket: "bkt", client: client as never });

    await expect(storage.readStream("missing.bin")).rejects.toThrow();
  });
});
