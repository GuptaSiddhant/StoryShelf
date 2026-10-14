import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageAdapter } from "../adapters/storage.ts";
import { persistStorybookStatics } from "./statics.ts";

function memoryStorage(): { storage: StorageAdapter; files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  const storage = {
    write: async (path: string, data: Buffer): Promise<void> => {
      files.set(path, data);
      await Promise.resolve();
    },
    exists: async (path: string): Promise<boolean> => {
      await Promise.resolve();
      return files.has(path);
    },
    writeStream: async (path: string, stream: Readable): Promise<void> => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
      files.set(path, Buffer.concat(chunks));
    },
  } as unknown as StorageAdapter;
  return { storage, files };
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "storyshelf-statics-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("persistStorybookStatics", () => {
  it("streams files to content-addressed and per-build paths with a manifest", async () => {
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, "index.html"), "<html></html>");
    await writeFile(join(dir, "assets", "a.js"), "same");
    await writeFile(join(dir, "assets", "b.js"), "same");
    const { storage, files } = memoryStorage();

    await persistStorybookStatics(storage, dir, "p1", "b1");

    expect(files.get(`content/${sha("same")}`)?.toString()).toBe("same");
    expect(files.get(`content/${sha("<html></html>")}`)).toBeDefined();
    const prefix = [...files.keys()]
      .find((key) => key.endsWith("/index.html"))
      ?.replace("/index.html", "");
    expect(prefix).toBeDefined();
    expect(files.get(`${prefix}/assets/b.js`)?.toString()).toBe("same");
    const manifest = JSON.parse(files.get(`${prefix}/manifest.json`)?.toString() ?? "{}");
    expect(manifest).toEqual({
      "index.html": sha("<html></html>"),
      "assets/a.js": sha("same"),
      "assets/b.js": sha("same"),
    });
  });

  it("handles more files than the concurrency cap", async () => {
    await Promise.all(
      Array.from({ length: 40 }, async (_, i) => {
        await writeFile(join(dir, `f${i}.js`), `file-${i}`);
      }),
    );
    const { storage, files } = memoryStorage();

    await persistStorybookStatics(storage, dir, "p1", "b1");

    const manifestKey = [...files.keys()].find((key) => key.endsWith("manifest.json")) ?? "";
    expect(Object.keys(JSON.parse(files.get(manifestKey)?.toString() ?? "{}"))).toHaveLength(40);
  });

  it("keeps source files intact when storage is rooted at the scratch dir", async () => {
    // Local storage rooted at the scratch dir: the per-build path IS the source file.
    const root = dir;
    const source = join(root, "p1", "builds", "b1", "storybook");
    await mkdir(join(source, "assets"), { recursive: true });
    await writeFile(join(source, "index.html"), "<html>real</html>");
    await writeFile(join(source, "assets", "app.js"), "console.log(1)");
    const fileStorage = {
      write: async (path: string, data: Buffer): Promise<void> => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), data);
      },
      exists: async (path: string): Promise<boolean> =>
        await readFile(join(root, path)).then(
          () => true,
          () => false,
        ),
      writeStream: async (path: string, stream: Readable): Promise<void> => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await pipeline(stream, createWriteStream(join(root, path)));
      },
    } as unknown as StorageAdapter;

    await persistStorybookStatics(fileStorage, source, "p1", "b1");

    expect(await readFile(join(source, "index.html"), "utf8")).toBe("<html>real</html>");
    expect(await readFile(join(source, "assets", "app.js"), "utf8")).toBe("console.log(1)");
  });
});
