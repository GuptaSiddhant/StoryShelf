/** Values `storyshelf init` proposes: Storybook metadata, package name and git repository / default branch. */
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { findStorybookMain } from "./load.ts";

/** Lightweight metadata extracted from `.storybook/main.*` for `storyshelf init`. */
export interface StorybookMeta {
  framework?: { name?: string; options?: unknown };
  addons?: string[];
  storiesGlobs?: string[];
  staticDirs?: string[];
  packagePath?: string;
}

/**
 * Detect the relative path from project root to the Storybook config directory.
 *
 * @param cwd - Project root
 * @returns Relative path (e.g. `.` or `packages/app/.storybook`'s parent)
 */
export async function detectPackagePath(cwd: string = process.cwd()): Promise<string> {
  const main = await findStorybookMain(cwd);
  if (!main) {
    return ".";
  }
  const rel = relative(cwd, dirname(main));
  return rel === "" ? "." : rel;
}

/**
 * Extract framework, addons, and globs from `.storybook/main.*` for `storyshelf init`.
 *
 * @param cwd - Project root
 * @returns Metadata with framework name, addons, and story globs when discoverable
 */
export async function detectStorybookMeta(cwd: string = process.cwd()): Promise<StorybookMeta> {
  const mainPath = await findStorybookMain(cwd);
  if (!mainPath) {
    return { packagePath: "." };
  }
  const meta = await parseMetaSource(mainPath);
  const rel = relative(cwd, dirname(mainPath));
  meta.packagePath = rel === "" ? "." : rel;
  return meta;
}

function parseFrameworkName(raw: string): string | undefined {
  const match = /framework\s*:\s*\{\s*name\s*:\s*["'](?<name>[^"']+)["']/u.exec(raw);
  return match?.groups?.["name"];
}

function parseQuotedList(raw: string, key: string): string[] {
  const section = new RegExp(`${key}\\s*:\\s*\\[(?<content>[\\s\\S]*?)\\]`, "u").exec(raw);
  const content = section?.groups?.["content"];
  if (!content) {
    return [];
  }
  return [...content.matchAll(/["'](?<item>[^"']+)["']/gu)]
    .map((match) => match.groups?.["item"])
    .filter((item): item is string => item !== undefined && item.length > 0);
}

async function parseMetaSource(mainPath: string): Promise<StorybookMeta> {
  const meta: StorybookMeta = {};
  try {
    const raw = await readFile(mainPath, "utf8");
    Object.assign(meta, parseMetaLists(raw));
    const framework = parseFrameworkName(raw);
    if (framework) {
      meta.framework = { name: framework };
    }
  } catch {
    // Ignore parse errors
  }
  return meta;
}

function parseMetaLists(
  raw: string,
): Pick<StorybookMeta, "addons" | "storiesGlobs" | "staticDirs"> {
  const lists: Pick<StorybookMeta, "addons" | "storiesGlobs" | "staticDirs"> = {};
  const keys = [
    ["addons", "addons"],
    ["stories", "storiesGlobs"],
    ["staticDirs", "staticDirs"],
  ] as const;
  for (const [key, prop] of keys) {
    const values = parseQuotedList(raw, key);
    if (values.length > 0) {
      lists[prop] = values;
    }
  }
  return lists;
}

/**
 * Read the package name from `package.json` if present.
 *
 * @param cwd - Project root
 * @returns Package name or `null` when unreadable or missing
 */
export async function detectPackageName(cwd: string = process.cwd()): Promise<string | null> {
  try {
    const raw = await readFile(resolve(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.length > 0) {
      return parsed.name;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect the git repository slug (`owner/repo`) from `remote.origin.url`.
 * Handles `git@`, `https://`, and `ssh://` forms and strips `.git`.
 *
 * @param cwd - Project root (used as `git -C` cwd)
 * @returns Normalized `owner/repo` or `null` when not a git repo
 */
export function detectGitRepository(cwd: string = process.cwd()): string | null {
  try {
    const url = execSync("git config --get remote.origin.url", { cwd, encoding: "utf8" }).trim();
    if (!url) {
      return null;
    }
    // Normalize git@github.com:owner/repo.git and https://github.com/owner/repo.git -> owner/repo
    const normalized = url
      .replace(/\.git$/u, "")
      .replace(/^git@[^:]+:/u, "")
      .replace(/^https?:\/\/[^/]+\//u, "")
      .replace(/^ssh:\/\/[^/]+\//u, "");
    return normalized || null;
  } catch {
    return null;
  }
}

/**
 * Detect the default branch, preferring `origin/HEAD` then `HEAD`.
 *
 * @param cwd - Project root
 * @returns Branch name (e.g. `main`) or `null` when not determinable
 */
export function detectGitDefaultBranch(cwd: string = process.cwd()): string | null {
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd,
      encoding: "utf8",
    }).trim();
    const match = /refs\/remotes\/origin\/(?<branch>.+)/u.exec(ref);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Fallback
  }
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8" }).trim();
    if (branch && branch !== "HEAD") {
      return branch;
    }
  } catch {
    // Ignore
  }
  return null;
}
