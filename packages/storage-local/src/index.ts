import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { StorageAdapter } from "@storyshelf/core/adapter/storage";

declare const __PKG_VERSION__: string;

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a local filesystem-backed StorageAdapter rooted at the given directory.
 *
 * @param dataDir - Root directory in which all stored files live.
 * @returns A StorageAdapter that reads and writes files under `dataDir`.
 */
export function createLocalStorage(dataDir: string): StorageAdapter {
  const root = resolve(dataDir);

  function toAbsolute(path: string): string {
    const target = resolve(root, path);
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new Error(`Path escapes storage directory: ${path}`);
    }
    return target;
  }

  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          return await walk(full);
        }
        return [relative(root, full)];
      }),
    );
    return nested.flat();
  }

  return {
    metadata: {
      name: "Local Storage",
      version: typeof __PKG_VERSION__ === "undefined" ? "0.0.0" : __PKG_VERSION__, // oxlint-disable-line unicorn/no-typeof-undefined
      description: "Local filesystem storage adapter",
      kind: "local",
    },
    async read(path) {
      return await readFile(toAbsolute(path));
    },
    async write(path, data) {
      const target = toAbsolute(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    },
    async delete(path) {
      await rm(toAbsolute(path), { force: true });
    },
    async exists(path) {
      return await pathExists(toAbsolute(path));
    },
    async list(prefix) {
      const dir = toAbsolute(prefix);
      if (!(await pathExists(dir))) {
        return [];
      }
      return walk(dir);
    },
  };
}
