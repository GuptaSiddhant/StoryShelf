/**
 * The monorepo hint: when the project root has no `.storybook/main.*` but a workspace package does,
 * say which package to run from. Only the workspace globs are read (`package.json#workspaces` and
 * `pnpm-workspace.yaml`); a glob deeper than one level (`apps/**`) is not crawled.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { findStorybookMain } from "./load.ts";

/** Where the CI guide explains `working-directory` for a Storybook inside a monorepo package. */
const CI_GUIDE_SECTION = 'the CI guide, "Storybook in a monorepo package"';

/** The `packages:` items of a pnpm-workspace.yaml (`- "x"` lines under the key). */
export function pnpmPackages(yaml: string): string[] {
  const patterns: string[] = [];
  let inList = false;
  for (const line of yaml.split(/\r?\n/u)) {
    if (/^packages\s*:/u.test(line)) {
      inList = true;
    } else if (inList && /^\S/u.test(line)) {
      inList = false;
    } else if (inList) {
      const item = /^\s*-\s*["']?(?<pattern>[^"'\s#]+)/u.exec(line)?.groups?.["pattern"];
      if (item) {
        patterns.push(item);
      }
    }
  }
  return patterns;
}

/** The workspace globs the root declares, from `package.json#workspaces` or `pnpm-workspace.yaml`. */
export async function workspacePatterns(cwd: string): Promise<string[]> {
  const patterns: string[] = [];
  const workspaces = await readJson(join(cwd, "package.json"));
  const declared = workspaces?.["workspaces"];
  const list = Array.isArray(declared) ? declared : asRecord(declared)?.["packages"];
  if (Array.isArray(list)) {
    patterns.push(...list.filter((item): item is string => typeof item === "string"));
  }
  try {
    patterns.push(...pnpmPackages(await readFile(join(cwd, "pnpm-workspace.yaml"), "utf8")));
  } catch {
    // No pnpm workspace file: the package.json globs are all there is.
  }
  return patterns.filter((pattern) => !pattern.startsWith("!"));
}

/**
 * The workspace package directories (relative to `cwd`, POSIX separators) that hold a
 * `.storybook/main.*`. A literal path is checked as it is; `dir/*` lists one level of `dir`.
 */
export async function findWorkspaceStorybooks(cwd: string): Promise<string[]> {
  const patterns = await workspacePatterns(cwd);
  const expanded = await Promise.all(
    patterns.map(async (pattern) => await expandPattern(cwd, pattern)),
  );
  const dirs = [...new Set(expanded.flat())].toSorted();
  const checked = await Promise.all(
    dirs.map(async (dir) => ((await findStorybookMain(join(cwd, dir))) ? dir : undefined)),
  );
  return checked.filter((dir): dir is string => dir !== undefined);
}

/** The directories one workspace pattern names; a pattern deeper than `dir/*` names none. */
async function expandPattern(cwd: string, pattern: string): Promise<string[]> {
  const clean = pattern.replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (!clean.includes("*")) {
    return [clean];
  }
  if (!clean.endsWith("/*") || clean.slice(0, -2).includes("*")) {
    return [];
  }
  const base = clean.slice(0, -2);
  const entries = await readdir(join(cwd, base), { withFileTypes: true }).catch(() => []);
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
    )
    .map((entry) => (base ? `${base}/${entry.name}` : entry.name));
}

/**
 * The sentence that names the workspace package holding a Storybook, for a root without one;
 * undefined when no workspace package has one. It points at the CI guide's `working-directory`.
 */
export async function monorepoHint(cwd: string): Promise<string | undefined> {
  const found = await findWorkspaceStorybooks(cwd);
  if (found.length === 0) {
    return undefined;
  }
  const [only] = found;
  const where =
    found.length === 1
      ? `found ${only}/.storybook: run this from ${only}`
      : `found ${found.map((dir) => `${dir}/.storybook`).join(", ")}: run this from the package you upload`;
  return `${where}. In CI, set working-directory to that package (${CI_GUIDE_SECTION}).`;
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return asRecord(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
