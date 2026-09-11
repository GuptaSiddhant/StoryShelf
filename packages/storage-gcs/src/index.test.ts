import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createGcsStorage, gcsKey } from "./index.ts";

interface FakeFileState {
  name: string;
  saveCalls: Buffer[];
  downloadResult?: Buffer;
  existsResult: boolean;
  deleteShouldThrow?: unknown;
}

interface FakeFile {
  name: string;
  save: (data: Buffer) => Promise<void>;
  download: () => Promise<[Buffer]>;
  exists: () => Promise<[boolean]>;
  delete: () => Promise<void>;
  createWriteStream: () => NodeJS.WritableStream;
  createReadStream: () => Readable;
}

function makeGcsClient(
  handlers: {
    save?: (name: string, data: Buffer) => Promise<void>;
    download?: (name: string) => Promise<[Buffer]>;
    exists?: (name: string) => Promise<[boolean]>;
    delete?: (name: string) => Promise<void>;
    getFiles?: (opts: unknown) => Promise<[FakeFile[]]>;
    createWriteStream?: (name: string) => NodeJS.WritableStream;
    createReadStream?: (name: string) => Readable;
  } = {},
): { client: unknown; files: Map<string, FakeFileState>; calls: string[] } {
  const calls: string[] = [];
  const files = new Map<string, FakeFileState>();

  function getOrCreate(name: string): FakeFileState {
    const existing = files.get(name);
    if (existing) {
      return existing;
    }
    const state: FakeFileState = { name, saveCalls: [], existsResult: false };
    files.set(name, state);
    return state;
  }

  type FakeBucket = {
    file: (name: string) => FakeFile;
    getFiles: (opts?: unknown) => Promise<[FakeFile[]]>;
  };

  const bucket: FakeBucket = {
    file(name: string): FakeFile {
      const state = getOrCreate(name);
      return {
        name,
        save: async (data: Buffer): Promise<void> => {
          calls.push(`save:${name}`);
          if (handlers.save) {
            await handlers.save(name, data);
            return;
          }
          state.saveCalls.push(data);
        },
        download: async (): Promise<[Buffer]> => {
          calls.push(`download:${name}`);
          if (handlers.download) {
            return await handlers.download(name);
          }
          return [state.downloadResult ?? Buffer.alloc(0)];
        },
        exists: async (): Promise<[boolean]> => {
          calls.push(`exists:${name}`);
          if (handlers.exists) {
            return await handlers.exists(name);
          }
          return [state.existsResult];
        },
        delete: async (): Promise<void> => {
          calls.push(`delete:${name}`);
          if (handlers.delete) {
            await handlers.delete(name);
            return;
          }
          if (state.deleteShouldThrow) {
            throw state.deleteShouldThrow;
          }
        },
        createWriteStream: (): NodeJS.WritableStream => {
          calls.push(`createWriteStream:${name}`);
          if (handlers.createWriteStream) {
            return handlers.createWriteStream(name);
          }
          return new Writable({
            write(chunk: Buffer, _encoding: string, callback: () => void): void {
              state.saveCalls.push(Buffer.from(chunk as Uint8Array));
              callback();
            },
          });
        },
        createReadStream: (): Readable => {
          calls.push(`createReadStream:${name}`);
          if (handlers.createReadStream) {
            return handlers.createReadStream(name);
          }
          return Readable.from([state.downloadResult ?? Buffer.alloc(0)]);
        },
      };
    },
    getFiles: async (opts?: unknown): Promise<[FakeFile[]]> => {
      calls.push(`getFiles:${JSON.stringify(opts ?? null)}`);
      if (handlers.getFiles) {
        return await handlers.getFiles(opts);
      }
      return [[]];
    },
  };

  const client = {
    bucket: (): FakeBucket => bucket,
  };

  return { client, files, calls };
}

describe("gcsKey", () => {
  it("joins a prefix and path into a GCS key", () => {
    expect(gcsKey("", "a/b.txt")).toBe("a/b.txt");
    expect(gcsKey("app", "a/b.txt")).toBe("app/a/b.txt");
    expect(gcsKey("app", "")).toBe("app/");
  });
});

describe("createGcsStorage - construct and write", () => {
  it("constructs a StorageAdapter without throwing", () => {
    const { client } = makeGcsClient();
    const storage = createGcsStorage({ bucket: "test-bucket", client: client as never });

    expect(storage).toBeDefined();
    expect(typeof storage.read).toBe("function");
    expect(typeof storage.write).toBe("function");
    expect(typeof storage.delete).toBe("function");
    expect(typeof storage.exists).toBe("function");
    expect(typeof storage.list).toBe("function");
  });

  it("write saves the buffer under the bucketed, prefixed key", async () => {
    const { client, calls } = makeGcsClient();
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });

    await storage.write("x/y.png", Buffer.from("hello"));

    expect(calls).toEqual(expect.arrayContaining(["save:app/x/y.png"]));
  });

  it("read downloads and returns the file bytes", async () => {
    const { client } = makeGcsClient({
      download: async () => [Buffer.from([1, 2, 3])],
    });
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });

    const result = await storage.read("x/y.png");

    expect(Buffer.from(result).toString("hex")).toBe("010203");
  });

  it("read returns a buffer from the GCS file", async () => {
    const { client } = makeGcsClient({
      download: async () => [Buffer.from("hello")],
    });
    const storage = createGcsStorage({ bucket: "bkt", client: client as never });

    await expect(storage.read("a.txt")).resolves.toEqual(Buffer.from("hello"));
  });
});

describe("createGcsStorage - delete and exists", () => {
  it("delete removes the prefixed key", async () => {
    const { client, calls } = makeGcsClient();
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });

    await storage.delete("x/y.png");

    expect(calls).toEqual(expect.arrayContaining(["delete:app/x/y.png"]));
  });

  it("delete ignores 404 errors", async () => {
    const { client } = makeGcsClient({
      delete: async (): Promise<void> => {
        const error = Object.assign(new Error("not found"), { code: 404 });
        throw error;
      },
    });
    const storage = createGcsStorage({ bucket: "bkt", client: client as never });

    await expect(storage.delete("missing.png")).resolves.toBeUndefined();
  });

  it("exists returns true when GCS reports the file exists", async () => {
    const { client } = makeGcsClient({
      exists: async () => [true],
    });
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });

    await expect(storage.exists("x/y.png")).resolves.toBe(true);
  });

  it("exists returns false when GCS reports the file missing", async () => {
    const { client } = makeGcsClient({
      exists: async () => [false],
    });
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });

    await expect(storage.exists("x/y.png")).resolves.toBe(false);
  });
});

describe("createGcsStorage - list", () => {
  it("list calls getFiles with prefix and strips the storage prefix from keys", async () => {
    const fakeFiles = [{ name: "app/a/1.png" }, { name: "app/a/2.png" }] as unknown as {
      name: string;
    }[];
    const { client } = makeGcsClient({
      getFiles: async () => [fakeFiles as never],
    });
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });

    const result = await storage.list("a");

    expect(result).toEqual(["a/1.png", "a/2.png"]);
  });

  it("list returns an empty array when there are no files", async () => {
    const { client } = makeGcsClient({
      getFiles: async () => [[]],
    });
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });

    await expect(storage.list("a")).resolves.toEqual([]);
  });

  it("returns unprefixed keys when no prefix is configured", async () => {
    const fakeFiles = [{ name: "a/1.png" }] as unknown as { name: string }[];
    const { client } = makeGcsClient({
      getFiles: async () => [fakeFiles as never],
    });
    const storage = createGcsStorage({ bucket: "bkt", client: client as never });

    await expect(storage.list("a")).resolves.toEqual(["a/1.png"]);
  });
});

describe("createGcsStorage - streams", () => {
  it("writeStream pipelines bytes to the GCS file", async () => {
    const { client, calls } = makeGcsClient();
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });

    await storage.writeStream("x/y.bin", Readable.from([Buffer.from("streamed")]));

    expect(calls).toEqual(expect.arrayContaining(["createWriteStream:app/x/y.bin"]));
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
      chunks.push(Buffer.from(chunk as Uint8Array));
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
