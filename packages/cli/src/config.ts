/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, eslint/no-await-in-loop, no-await-in-loop, max-depth, eslint/max-depth, max-statements, max-lines-per-function, complexity, eslint/max-statements, eslint/max-lines-per-function, eslint/complexity, typescript/prefer-regexp-exec, eslint/no-useless-escape, no-useless-escape, typescript/prefer-nullish-coalescing */
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

export async function findStorybookMain(cwd: string = process.cwd()): Promise<string | null> {
  for (const candidate of MAIN_CANDIDATES) {
    const full = resolve(cwd, candidate);
    try {
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
    // Backward compat: storybookDir -> buildDir
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed !== null &&
      "storybookDir" in (parsed as Record<string, unknown>)
    ) {
      const parsedRecord = parsed as Record<string, unknown>;
      if (typeof parsedRecord["storybookDir"] === "string" && !parsedRecord["buildDir"]) {
        parsedRecord["buildDir"] = parsedRecord["storybookDir"];
      }
      delete parsedRecord["storybookDir"];
    }
    const result = storybookConfigSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
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
  const merged = existing ? { ...existing, ...config } : config;
  // Backward compat: map deprecated storybookDir -> buildDir if present in file
  const withCompat = { ...merged } as Record<string, unknown> & StorybookConfig;
  if ((withCompat as Record<string, unknown>)["storybookDir"] && !withCompat.buildDir) {
    withCompat.buildDir = (withCompat as Record<string, unknown>)["storybookDir"] as string;
    delete (withCompat as Record<string, unknown>)["storybookDir"];
  }
  const result = storybookConfigSchema.safeParse(withCompat);
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
  const meta: StorybookMeta = {};
  const mainPath = await findStorybookMain(cwd);
  if (mainPath) {
    try {
      const raw = await readFile(mainPath, "utf8");
      const frameworkMatch = raw.match(
        /framework\s*:\s*\{\s*name\s*:\s*["'](?<frameworkName>[^"']+)["']/u,
      );
      if (frameworkMatch?.[1]) {
        meta.framework = { name: frameworkMatch[1] };
      }
      const addonsMatch = raw.match(/addons\s*:\s*\[(?<addonsContent>[\s\S]*?)\]/u);
      if (addonsMatch?.[1]) {
        const addons = [...addonsMatch[1].matchAll(/["'](?<addonName>[^"']+)["']/gu)]
          .map((match) => match[1])
          .filter(Boolean) as string[];
        if (addons.length > 0) {
          meta.addons = addons;
        }
      }
      const storiesMatch = raw.match(/stories\s*:\s*\[(?<storiesContent>[\s\S]*?)\]/u);
      if (storiesMatch?.[1]) {
        const globs = [...storiesMatch[1].matchAll(/["'](?<storyGlob>[^"']+)["']/gu)]
          .map((match) => match[1])
          .filter(Boolean) as string[];
        if (globs.length > 0) {
          meta.storiesGlobs = globs;
        }
      }
      const staticDirsMatch = raw.match(/staticDirs\s*:\s*\[(?<staticDirsContent>[\s\S]*?)\]/u);
      if (staticDirsMatch?.[1]) {
        const dirs = [...staticDirsMatch[1].matchAll(/["'](?<staticDir>[^"']+)["']/gu)]
          .map((match) => match[1])
          .filter(Boolean) as string[];
        if (dirs.length > 0) {
          meta.staticDirs = dirs;
        }
      }
      const rel = relative(cwd, dirname(mainPath));
      meta.packagePath = rel === "" ? "." : rel;
    } catch {
      // Ignore parse errors
    }
  } else {
    meta.packagePath = ".";
  }
  return meta;
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
    const match = ref.match(/refs\/remotes\/origin\/(?<branch>.+)/u);
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
