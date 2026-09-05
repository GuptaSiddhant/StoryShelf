import { execSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";

export const storybookConfigSchema = z
  .object({
    slug: z.string().min(1, "slug is required"),
    // oxlint-disable-next-line typescript/no-deprecated -- z.string().url() kept for zod v3 API compat
    url: z.string().url().optional(),
    buildDir: z.string().min(1).optional(),
    buildCommand: z.string().min(1).optional(),
    buildScriptName: z.string().min(1).optional(),
    skip: z.string().min(1).optional(),
  })
  .refine((data) => !(data.buildCommand && data.buildScriptName), {
    message: "buildCommand and buildScriptName are mutually exclusive",
    path: ["buildCommand"],
  });

export type StorybookConfig = z.infer<typeof storybookConfigSchema>;

const CONFIG_RELATIVE = join(".storybook", "storyshelf.json");

const MAIN_CANDIDATES = [
  ".storybook/main.js",
  ".storybook/main.ts",
  ".storybook/main.mjs",
  ".storybook/main.cjs",
  ".storybook/main.mts",
  ".storybook/main.cts",
  ".storybook/main.jsx",
  ".storybook/main.tsx",
];

/** Map the deprecated `storybookDir` key onto `buildDir` in place. */
function migrateDeprecatedDir(parsed: unknown): void {
  if (typeof parsed !== "object" || parsed === null) {
    return;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record["storybookDir"] === "string" && !record["buildDir"]) {
    record["buildDir"] = record["storybookDir"];
  }
  delete record["storybookDir"];
}

export async function findStorybookMain(cwd: string = process.cwd()): Promise<string | null> {
  for (const candidate of MAIN_CANDIDATES) {
    const full = resolve(cwd, candidate);
    try {
      // eslint-disable-next-line no-await-in-loop -- probe candidates in order, return first hit
      await access(full);
      return full;
    } catch {
      // Not found, continue
    }
  }
  return null;
}

export async function assertStorybookMain(cwd: string = process.cwd()): Promise<void> {
  const found = await findStorybookMain(cwd);
  if (!found) {
    throw new Error(".storybook/main.* not found — ensure Storybook is set up in this project");
  }
}

export async function loadStorybookConfig(
  cwd: string = process.cwd(),
  customPath?: string,
): Promise<StorybookConfig | null> {
  const full = customPath ? resolve(cwd, customPath) : resolve(cwd, CONFIG_RELATIVE);
  try {
    const raw = await readFile(full, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    migrateDeprecatedDir(parsed);
    const result = storybookConfigSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

/** Merge an existing config with new values, applying deprecated-key migration. */
function mergeConfigs(existing: StorybookConfig | null, config: StorybookConfig): StorybookConfig {
  const merged = existing ? { ...existing, ...config } : { ...config };
  migrateDeprecatedDir(merged);
  return merged;
}

export async function writeStorybookConfig(
  config: StorybookConfig,
  cwd: string = process.cwd(),
  customPath?: string,
): Promise<string> {
  const full = customPath ? resolve(cwd, customPath) : resolve(cwd, CONFIG_RELATIVE);
  const dir = dirname(full);
  await mkdir(dir, { recursive: true });
  const existing = await loadStorybookConfig(cwd, customPath);
  const merged = mergeConfigs(existing, config);
  const result = storybookConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid storybook config: ${result.error.message}`);
  }
  await writeFile(full, `${JSON.stringify(result.data, null, 2)}\n`, "utf8");
  return full;
}

export interface StorybookMeta {
  framework?: { name?: string; options?: unknown };
  addons?: string[];
  storiesGlobs?: string[];
  staticDirs?: string[];
  packagePath?: string;
}

export async function detectPackagePath(cwd: string = process.cwd()): Promise<string> {
  const main = await findStorybookMain(cwd);
  if (!main) {
    return ".";
  }
  const rel = relative(cwd, dirname(main));
  return rel === "" ? "." : rel;
}

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

function parseMetaLists(raw: string): Pick<StorybookMeta, "addons" | "storiesGlobs" | "staticDirs"> {
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
