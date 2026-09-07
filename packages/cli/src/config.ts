import { execSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

/** Validated `.storybook/storyshelf.json` contents. */
export interface StorybookConfig {
  slug: string;
  url?: string;
  buildDir?: string;
  buildCommand?: string;
  buildScriptName?: string;
  skip?: string;
}

/** Parse an unknown value into a `StorybookConfig`, or return the reason it is invalid. */
function parseStorybookConfig(value: unknown): ParseResult {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "expected an object" };
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const slug = readSlug(record);
  if (!slug.ok) {
    return slug;
  }
  const optional = readOptionalStrings(record, OPTIONAL_CONFIG_KEYS);
  if (!optional.ok) {
    return optional;
  }
  return checkCrossFieldRules(slug.slug, optional.values);
}

/** Read the required slug field. */
function readSlug(
  record: Record<string, unknown>,
): { ok: true; slug: string } | { ok: false; error: string } {
  const slug = record["slug"];
  if (typeof slug !== "string" || slug.length === 0) {
    return { ok: false, error: "slug is required" };
  }
  return { ok: true, slug };
}

/** Optional config keys with plain string values. */
const OPTIONAL_CONFIG_KEYS = [
  "url",
  "buildDir",
  "buildCommand",
  "buildScriptName",
  "skip",
] as const;

type ParseResult = { ok: true; config: StorybookConfig } | { ok: false; error: string };

/** Read optional non-empty string fields; any present-but-invalid field is an error. */
function readOptionalStrings(
  record: Record<string, unknown>,
  keys: readonly string[],
): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  const values: Record<string, string> = {};
  for (const key of keys) {
    const raw = record[key];
    if (raw === undefined) {
      continue;
    }
    if (typeof raw !== "string" || raw.length === 0) {
      return { ok: false, error: `${key} must be a non-empty string` };
    }
    values[key] = raw;
  }
  return { ok: true, values };
}

/** Enforce url shape and the buildCommand/buildScriptName exclusion. */
function checkCrossFieldRules(slug: string, values: Record<string, string>): ParseResult {
  const url = values["url"];
  if (url !== undefined && !isHttpUrl(url)) {
    return { ok: false, error: "url must be a valid http(s) URL" };
  }
  if (values["buildCommand"] && values["buildScriptName"]) {
    return { ok: false, error: "buildCommand and buildScriptName are mutually exclusive" };
  }
  const { buildDir, buildCommand, buildScriptName, skip } = values;
  return {
    ok: true,
    config: {
      slug,
      ...(url === undefined ? {} : { url }),
      ...(buildDir === undefined ? {} : { buildDir }),
      ...(buildCommand === undefined ? {} : { buildCommand }),
      ...(buildScriptName === undefined ? {} : { buildScriptName }),
      ...(skip === undefined ? {} : { skip }),
    },
  };
}

/** True for http(s) URLs. */
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

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
    const result = parseStorybookConfig(parsed);
    if (!result.ok) {
      return null;
    }
    return result.config;
  } catch {
    return null;
  }
}

/** Merge an existing config with new values. */
function mergeConfigs(existing: StorybookConfig | null, config: StorybookConfig): StorybookConfig {
  return existing ? { ...existing, ...config } : { ...config };
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
  const result = parseStorybookConfig(merged);
  if (!result.ok) {
    throw new Error(`Invalid storybook config: ${result.error}`);
  }
  await writeFile(full, `${JSON.stringify(result.config, null, 2)}\n`, "utf8");
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
