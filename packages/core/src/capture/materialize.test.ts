import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageAdapter } from "../adapters/storage.ts";
import {
  COMPLETE_MARKER,
  MissingContentError,
  materializeStorybook,
  prepareStorybook,
} from "./materialize.ts";
import { ZipInvalidError } from "./publish/invalid-zip.ts";
import { ZipLimitError } from "./publish/limits.ts";
import { buildScratchDir, removeJobScratch, removeShardScratch } from "./scratch.ts";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

function storageWith(files: Record<string, string>): {
  storage: StorageAdapter;
  reads: string[];
} {
  const reads: string[] = [];
  const storage = {
    exists: async (key: string) => await Promise.resolve(key in files),
    read: async (key: string) => {
      reads.push(key);
      const value = files[key];
      if (value === undefined) throw new Error(`missing ${key}`);
      return await Promise.resolve(Buffer.from(value));
    },
    readStream: async () => {
      throw new Error("storybook.zip must not be read");
    },
  } as unknown as StorageAdapter;
  return { storage, reads };
}

function publishedBuild(entries: Record<string, string>): Record<string, string> {
  const files: Record<string, string> = {};
  const manifest: Record<string, string> = {};
  for (const [rel, text] of Object.entries(entries)) {
    manifest[rel] = sha(text);
    files[`content/${sha(text)}`] = text;
  }
  files["p1/builds/b1/storybook/manifest.json"] = JSON.stringify(manifest);
  return files;
}

let scratch = "";
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "storyshelf-materialize-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("materializeStorybook", () => {
  it("fills scratch from the manifest and blobs, never reading the zip", async () => {
    const { storage } = storageWith(
      publishedBuild({ "index.json": "{}", "assets/a.js": "a", "assets/b.js": "a" }),
    );
    const dir = await materializeStorybook(storage, scratch, "p1", "b1");
    expect(dir).not.toBeNull();
    expect(await readFile(join(dir as string, "assets/b.js"), "utf8")).toBe("a");
    expect(await readFile(join(dir as string, "index.json"), "utf8")).toBe("{}");
  });

  it("returns null when the build has no manifest", async () => {
    const { storage } = storageWith({});
    expect(await materializeStorybook(storage, scratch, "p1", "b1")).toBeNull();
  });

  it("reuses a complete tree for the same build without reading the blobs", async () => {
    const { storage, reads } = storageWith(publishedBuild({ "index.json": "{}" }));
    await materializeStorybook(storage, scratch, "p1", "b1");
    const before = reads.length;
    await materializeStorybook(storage, scratch, "p1", "b1");
    expect(reads.slice(before)).toEqual(["p1/builds/b1/storybook/manifest.json"]);
  });

  it("rebuilds when the tree was removed or the marker is stale", async () => {
    const { storage } = storageWith(publishedBuild({ "index.json": "{}" }));
    const dir = (await materializeStorybook(storage, scratch, "p1", "b1")) as string;
    await rm(dir, { recursive: true });
    await materializeStorybook(storage, scratch, "p1", "b1");
    expect(await readFile(join(dir, "index.json"), "utf8")).toBe("{}");
    await writeFile(join(dir, "..", COMPLETE_MARKER), "stale");
    await writeFile(join(dir, "extra.txt"), "leftover");
    await materializeStorybook(storage, scratch, "p1", "b1");
    await expect(stat(join(dir, "extra.txt"))).rejects.toThrow();
  });

  it("gives each shard a directory of its own", async () => {
    const { storage } = storageWith(publishedBuild({ "index.json": "{}" }));
    const a = await materializeStorybook(storage, scratch, "p1", "b1", { shardId: "s1" });
    const b = await materializeStorybook(storage, scratch, "p1", "b1", { shardId: "s2" });
    expect(a).not.toBe(b);
  });

  it.each(["../escape.txt", "a/../../x", "/abs", "a//b", "a\\b", "./x", ""])(
    "refuses the manifest path %j",
    async (rel) => {
      const files = publishedBuild({ "index.json": "{}" });
      files["p1/builds/b1/storybook/manifest.json"] = JSON.stringify({ [rel]: sha("{}") });
      const { storage } = storageWith(files);
      await expect(materializeStorybook(storage, scratch, "p1", "b1")).rejects.toThrow(
        ZipInvalidError,
      );
    },
  );

  it("refuses a bad hash, a blob that does not match, and a manifest that is not an object", async () => {
    const files = publishedBuild({ "index.json": "{}" });
    files["p1/builds/b1/storybook/manifest.json"] = JSON.stringify({ "a.js": "../x" });
    await expect(
      materializeStorybook(storageWith(files).storage, scratch, "p1", "b1"),
    ).rejects.toThrow(ZipInvalidError);
    const tampered = publishedBuild({ "a.js": "a" });
    tampered[`content/${sha("a")}`] = "tampered";
    await expect(
      materializeStorybook(storageWith(tampered).storage, scratch, "p1", "b1"),
    ).rejects.toThrow(ZipInvalidError);
    const list = { "p1/builds/b1/storybook/manifest.json": "[]" };
    await expect(
      materializeStorybook(storageWith(list).storage, scratch, "p1", "b1"),
    ).rejects.toThrow(ZipInvalidError);
  });

  it("enforces the entry and byte caps", async () => {
    const { storage } = storageWith(publishedBuild({ "a.js": "aaaa", "b.js": "bbbb" }));
    await expect(
      materializeStorybook(storage, scratch, "p1", "b1", {
        limits: { maxEntries: 1, maxBytes: 100 },
      }),
    ).rejects.toThrow(ZipLimitError);
    await expect(
      materializeStorybook(storage, scratch, "p1", "b1", {
        limits: { maxEntries: 10, maxBytes: 5 },
      }),
    ).rejects.toThrow(ZipLimitError);
  });

  it("fails with the missing content hash, never falling back to the zip", async () => {
    const files = publishedBuild({ "a.js": "a" });
    delete files[`content/${sha("a")}`];
    const error = await prepareStorybook(storageWith(files).storage, scratch, "p1", "b1").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MissingContentError);
    expect((error as Error).message).toContain(sha("a"));
  });

  it("leaves a storage failure for a present blob unwrapped, so the job retries it", async () => {
    const files = publishedBuild({ "a.js": "a" });
    const { storage } = storageWith(files);
    const read = storage.read.bind(storage);
    storage.read = async (key: string) => {
      if (key.startsWith("content/")) throw new Error("timeout");
      return await read(key);
    };
    await expect(prepareStorybook(storage, scratch, "p1", "b1")).rejects.toThrow("timeout");
  });

  it("leaves no tree behind on failure, cancel or a missing blob", async () => {
    const files = publishedBuild({ "a.js": "a", "b.js": "b" });
    delete files[`content/${sha("b")}`];
    await expect(
      materializeStorybook(storageWith(files).storage, scratch, "p1", "b1"),
    ).rejects.toThrow("missing");
    const controller = new AbortController();
    controller.abort(new Error("lease lost"));
    await expect(
      materializeStorybook(
        storageWith(publishedBuild({ "a.js": "a" })).storage,
        scratch,
        "p1",
        "b1",
        {
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow("lease lost");
    const left = await readdir(join(buildScratchDir(scratch, "p1", "b1"), "job")).catch(() => []);
    expect(left).toEqual([]);
  });

  it("never exposes a half-built tree: the directory appears only whole", async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) entries[`f${i}.js`] = `content ${i}`;
    const { storage } = storageWith(publishedBuild(entries));
    const target = join(buildScratchDir(scratch, "p1", "b1"), "job", "storybook");
    const sizes: number[] = [];
    const polls: Promise<unknown>[] = [];
    const timer = setInterval(() => {
      polls.push(
        readdir(target).then(
          (names) => sizes.push(names.length),
          () => 40,
        ),
      );
    }, 0);
    await Promise.all([
      materializeStorybook(storage, scratch, "p1", "b1"),
      materializeStorybook(storage, scratch, "p1", "b1"),
    ]);
    clearInterval(timer);
    await Promise.all(polls);
    expect(sizes.every((size) => size === 40)).toBe(true);
    expect(await readdir(join(target, ".."))).toEqual(
      expect.arrayContaining(["storybook", COMPLETE_MARKER]),
    );
  });

  it("is removed with the job's and the shard's scratch", async () => {
    const { storage } = storageWith(publishedBuild({ "index.json": "{}" }));
    await materializeStorybook(storage, scratch, "p1", "b1");
    await materializeStorybook(storage, scratch, "p1", "b1", { shardId: "s1" });
    await removeJobScratch(scratch, "p1", "b1");
    await removeShardScratch(scratch, "p1", "b1", "s1");
    await expect(stat(buildScratchDir(scratch, "p1", "b1"))).rejects.toThrow();
  });
});

describe("prepareStorybook", () => {
  it("falls back to the zip only when there is no manifest", async () => {
    const { storage } = storageWith({});
    await expect(prepareStorybook(storage, scratch, "p1", "b1")).rejects.toThrow(
      "storybook.zip must not be read",
    );
  });

  it("uses the manifest when there is one", async () => {
    const { storage } = storageWith(publishedBuild({ "index.json": "{}" }));
    const dir = await prepareStorybook(storage, scratch, "p1", "b1");
    expect(await readFile(join(dir, "index.json"), "utf8")).toBe("{}");
    vi.restoreAllMocks();
    await mkdir(dir, { recursive: true });
  });
});
