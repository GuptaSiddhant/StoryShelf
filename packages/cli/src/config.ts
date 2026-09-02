/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, eslint/no-await-in-loop */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { z } from "zod";

export const storybookConfigSchema = z.object({
  slug: z.string().min(1, "slug is required"),
  url: z.url().optional(),
  storybookDir: z.string().min(1).optional(),
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
      // not found, continue
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

export async function loadStorybookConfig(cwd: string = process.cwd()): Promise<StorybookConfig | null> {
  const full = resolve(cwd, CONFIG_RELATIVE);
  try {
    const raw = await readFile(full, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
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
): Promise<string> {
  const dir = resolve(cwd, ".storybook");
  const full = resolve(cwd, CONFIG_RELATIVE);
  await mkdir(dir, { recursive: true });
  const existing = await loadStorybookConfig(cwd);
  const merged = existing ? { ...existing, ...config } : config;
  const result = storybookConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid storybook config: ${result.error.message}`);
  }
  await writeFile(full, JSON.stringify(result.data, null, 2) + "\n", "utf-8");
  return full;
}
