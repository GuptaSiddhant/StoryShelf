import { describe, expect, it } from "vitest";
import { createGcsStorage } from "./index.ts";

interface FakeFile {
  name: string;
  save: (data: Buffer) => Promise<void>;
  download: () => Promise<[Buffer]>;
  exists: () => Promise<[boolean]>;
  delete: () => Promise<void>;
}

function makeGcsClient(
  handlers: {
    save?: (name: string, data: Buffer) => Promise<void>;
    download?: (name: string) => Promise<[Buffer]>;
    exists?: (name: string) => Promise<[boolean]>;
    delete?: (name: string) => Promise<void>;
    getFiles?: (opts: unknown) => Promise<[FakeFile[]]>;
  } = {},
): { client: unknown; calls: string[] } {
  const calls: string[] = [];

  type FakeBucket = {
    file: (name: string) => FakeFile;
    getFiles: (opts?: unknown) => Promise<[FakeFile[]]>;
  };

  const bucket: FakeBucket = {
    file(name: string): FakeFile {
      return {
        name,
        save: async (data: Buffer): Promise<void> => {
          calls.push(`save:${name}`);
          if (handlers.save) {
            await handlers.save(name, data);
          }
        },
        download: async (): Promise<[Buffer]> => {
          calls.push(`download:${name}`);
          if (handlers.download) {
            return await handlers.download(name);
          }
          return [Buffer.alloc(0)];
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

  return { client: { bucket: (): FakeBucket => bucket }, calls };
}

describe("createGcsStorage - write and read", () => {
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

  it("delete rethrows non-404 errors", async () => {
    const { client } = makeGcsClient({
      delete: async (): Promise<void> => {
        throw new Error("boom");
      },
    });
    const storage = createGcsStorage({ bucket: "bkt", client: client as never });

    await expect(storage.delete("a.txt")).rejects.toThrow("boom");
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

  it("follows nextQuery across pages until the pageToken is exhausted", async () => {
    const { client, calls } = makeGcsClient({
      getFiles: async (opts) => {
        const token = (opts as { pageToken?: string }).pageToken;
        const files = token
          ? [{ name: "app/a/3.png" }]
          : [{ name: "app/a/1.png" }, { name: "app/a/2.png" }];
        const nextQuery = token ? null : { pageToken: "next" };
        return [files as never, nextQuery] as never;
      },
    });
    const storage = createGcsStorage({ bucket: "bkt", prefix: "app", client: client as never });

    const result = await storage.list("a");

    expect(result).toEqual(["a/1.png", "a/2.png", "a/3.png"]);
    expect(calls).toContain('getFiles:{"prefix":"app/a","autoPaginate":false}');
    expect(calls).toContain('getFiles:{"pageToken":"next"}');
  });

  it("list sends no prefix when listPrefix is empty and no storage prefix is set", async () => {
    const fakeFiles = [{ name: "a/1.png" }] as unknown as { name: string }[];
    const { client, calls } = makeGcsClient({
      getFiles: async () => [fakeFiles as never],
    });
    const storage = createGcsStorage({ bucket: "bkt", client: client as never });

    await expect(storage.list("")).resolves.toEqual(["a/1.png"]);

    expect(calls).toContain('getFiles:{"autoPaginate":false}');
  });
});
