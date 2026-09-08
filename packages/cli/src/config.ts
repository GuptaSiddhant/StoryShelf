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

/**
 * Locate the Storybook config file (`.storybook/main.*`) in the project.
 * Probes `.js`, `.ts`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.jsx`, `.tsx` in order.
 *
 * @param cwd - Project root to search from; defaults to `process.cwd()`
 * @returns Absolute path to the first candidate that exists, or `null` if none found
 */
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

/**
 * Ensure a Storybook config exists, throwing a human-readable error otherwise.
 *
 * @param cwd - Project root to search from
 * @throws If `.storybook/main.*` cannot be found
 */
export async function assertStorybookMain(cwd: string = process.cwd()): Promise<void> {
  const found = await findStorybookMain(cwd);
  if (!found) {
    throw new Error(".storybook/main.* not found — ensure Storybook is set up in this project");
  }
}

/**
 * Load and validate `.storybook/storyshelf.json` if it exists.
 *
 * @param cwd - Project root
 * @param customPath - Optional explicit config path (overrides the conventional location)
 * @returns Validated config or `null` when the file is missing or invalid
 */
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

/**
 * Persist a `StorybookConfig` to `.storybook/storyshelf.json`, merging with any
 * existing file so unrelated keys are preserved.
 *
 * @param config - Partial config to write (merged with existing)
 * @param cwd - Project root
 * @param customPath - Optional explicit path
 * @returns Absolute path to the written file
 * @throws If the merged result fails validation
 */
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
 * Detect the default git branch, preferring `origin/HEAD` then `HEAD`.
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

/** Package runners with distinct script-invocation syntax. */
export type PackageRunner = "npm" | "pnpm" | "yarn" | "bun" | "deno" | "nub";

/** Install/start commands per runner (host-side instructions and scaffolds). */
const RUNNER_COMMANDS: Record<PackageRunner, { install: string; start: string }> = {
  npm: { install: "npm install", start: "npm start" },
  pnpm: { install: "pnpm install", start: "pnpm start" },
  yarn: { install: "yarn install", start: "yarn start" },
  bun: { install: "bun install", start: "bun run start" },
  deno: { install: "deno install", start: "deno task start" },
  nub: { install: "nub install", start: "nub run start" },
};

/** Install command for a runner (e.g. `pnpm install`). */
export function installCommand(runner: PackageRunner): string {
  return RUNNER_COMMANDS[runner].install;
}

/** Start command for a runner (e.g. `pnpm start`). */
export function startCommand(runner: PackageRunner): string {
  return RUNNER_COMMANDS[runner].start;
}

const KNOWN_RUNNERS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn", "bun", "deno", "nub"]);

/** Normalize a runner name from a `a/b` value (`npm_config_user_agent`, `packageManager` field). */
function asRunner(value: string | undefined): PackageRunner | undefined {
  const name = value?.split(/[/@]/u)[0]?.trim().toLowerCase();
  return name !== undefined && KNOWN_RUNNERS.has(name) ? (name as PackageRunner) : undefined;
}

/** Lockfiles evidencing a package runner, in check order. */
const RUNNER_LOCKFILES: { file: string; runner: PackageRunner }[] = [
  { file: "nub.lock", runner: "nub" },
  { file: "bun.lockb", runner: "bun" },
  { file: "bun.lock", runner: "bun" },
  { file: "pnpm-lock.yaml", runner: "pnpm" },
  { file: "yarn.lock", runner: "yarn" },
  { file: "package-lock.json", runner: "npm" },
  { file: "deno.lock", runner: "deno" },
];

async function readPackageManagerField(cwd: string): Promise<unknown> {
  try {
    const raw = await readFile(resolve(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { packageManager?: unknown };
    return parsed.packageManager;
  } catch {
    return undefined;
  }
}

/**
 * Detect the project's package runner: invoking agent env, then the
 * `packageManager` field, then lockfiles, defaulting to npm.
 */
export async function detectPackageRunner(cwd: string = process.cwd()): Promise<PackageRunner> {
  const fromAgent = asRunner(process.env["npm_config_user_agent"]);
  if (fromAgent) {
    return fromAgent;
  }
  const field = await readPackageManagerField(cwd);
  const declared = typeof field === "string" ? asRunner(field) : undefined;
  if (declared) {
    return declared;
  }
  return (await runnerFromLockfiles(cwd)) ?? "npm";
}

/** First runner evidenced by a lockfile, or undefined when none match. */
async function runnerFromLockfiles(cwd: string): Promise<PackageRunner | undefined> {
  for (const { file, runner } of RUNNER_LOCKFILES) {
    try {
      // eslint-disable-next-line no-await-in-loop -- probe candidates in order, return first hit
      await access(resolve(cwd, file));
      return runner;
    } catch {
      continue;
    }
  }
  return undefined;
}
