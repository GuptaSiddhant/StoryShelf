/* oxlint-disable no-await-in-loop */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export interface HashedFile {
  rel: string;
  hash: string;
  size: number;
}

export async function walkFiles(cwd: string, buildDir: string): Promise<string[]> {
  const root = resolve(cwd, buildDir);
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        files.push(relative(root, full));
      }
    }
  }
  await walk(root);
  return files;
}

export async function hashFiles(
  cwd: string,
  buildDir: string,
  files: string[],
): Promise<HashedFile[]> {
  const root = resolve(cwd, buildDir);
  const results: HashedFile[] = [];
  for (const rel of files) {
    const full = join(root, rel);
    const buffer = await readFile(full);
    const hash = createHash("sha256").update(buffer).digest("hex");
    const { size } = await stat(full);
    results.push({ rel, hash, size });
  }
  return results;
}
