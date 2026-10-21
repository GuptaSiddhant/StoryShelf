import type { StorageAdapter } from "@storyshelf/core/adapter/storage";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { storageKey } from "./keys.ts";

declare const __PKG_VERSION__: string | undefined;

/**
 * Create a local filesystem-backed StorageAdapter rooted at the given directory.
 *
 * @param dataDir - Root directory in which all stored files live.
 * @returns A StorageAdapter that reads and writes files under `dataDir`.
 */
export function createLocalStorage(dataDir: string): StorageAdapter {
  const root = resolve(dataDir);

  return {
    metadata: {
      name: "Local Storage",
      version: typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0",
      description: "Local filesystem storage adapter",
      kind: "local",
      category: "storage",
    },
    lifecycle: {
      setup: async () => {
        await mkdir(root, { recursive: true });
      },
      teardown: async () => {
        // No handles held — nothing to destroy.
        await Promise.resolve();
      },
      health: async () => {
        const ok = await pathExists(root);
        return { ok };
      },
    },
    async read(path) {
      return await readFile(toAbsolute(root, path));
    },
    async write(path, data) {
      await writeAtomically(toAbsolute(root, path), async (temp) => {
        await writeFile(temp, data);
      });
    },
    async delete(path) {
      await rm(toAbsolute(root, path), { force: true });
    },
    async exists(path) {
      return await pathExists(toAbsolute(root, path));
    },
    async list(prefix) {
      const dir = toAbsolute(root, prefix);
      if (!(await pathExists(dir))) {
        return [];
      }
      return walk(root, dir);
    },
    ...buildStreamMethods(root),
  };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write through a temp file in the target's directory, then rename it into place: a write cut
 * short by a crash or kill never leaves a torn file at `target` (content-addressed screenshots
 * trust an existing object, so a torn one would poison every later capture with those bytes).
 * The temp name is a dotfile ending in `.tmp`, so it never looks like a stored screenshot.
 */
async function writeAtomically(
  target: string,
  fill: (temp: string) => Promise<void>,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  try {
    await fill(temp);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function toAbsolute(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`Path escapes storage directory: ${path}`);
  }
  return target;
}

async function walk(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return await walk(root, full);
      }
      return [storageKey(relative(root, full))];
    }),
  );
  return nested.flat();
}

/** Streaming reads/writes for a local storage root (split for lint limits). */
function buildStreamMethods(root: string): Pick<StorageAdapter, "writeStream" | "readStream"> {
  return {
    async writeStream(path, stream) {
      await writeAtomically(toAbsolute(root, path), async (temp) => {
        await pipeline(stream, createWriteStream(temp));
      });
    },
    async readStream(path) {
      const target = toAbsolute(root, path);
      if (!(await pathExists(target))) {
        throw new Error(`No object at "${path}"`);
      }
      return createReadStream(target);
    },
  };
}
