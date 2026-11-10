/** Finding, loading and writing `.storybook/storyshelf.json` (and the Storybook `main.*` next to it). */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseStorybookConfig, schemaReference, type StorybookConfig } from "./schema.ts";

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

/** Write options for `writeStorybookConfig`. */
export interface WriteConfigOptions {
  /** Stamp a fresh `$schema` reference (used by init). */
  stampSchema?: boolean;
}

/**
 * Persist a `StorybookConfig` to `.storybook/storyshelf.json`, merging with any
 * existing file so unrelated keys are preserved.
 *
 * @param config - Partial config to write (merged with existing)
 * @param cwd - Project root
 * @param customPath - Optional explicit path
 * @param options - Set `stampSchema` to write a fresh `$schema` reference;
 * otherwise a pre-existing `$schema` is preserved as-is
 * @returns Absolute path to the written file
 * @throws If the merged result fails validation
 */
export async function writeStorybookConfig(
  config: StorybookConfig,
  cwd: string = process.cwd(),
  customPath?: string,
  options: WriteConfigOptions = {},
): Promise<string> {
  const full = customPath ? resolve(cwd, customPath) : resolve(cwd, CONFIG_RELATIVE);
  const dir = dirname(full);
  await mkdir(dir, { recursive: true });
  const merged = mergeConfigs(await loadStorybookConfig(cwd, customPath), config);
  const result = parseStorybookConfig(merged);
  if (!result.ok) {
    throw new Error(`Invalid storybook config: ${result.error}`);
  }
  await writeConfigFile(full, result.config, await resolveWriteSchema(full, dir, options));
  return full;
}

/** Resolve the `$schema` to write: fresh stamp or the existing value. */
async function resolveWriteSchema(
  full: string,
  dir: string,
  options: WriteConfigOptions,
): Promise<string | undefined> {
  if (options.stampSchema) {
    return schemaReference(dir);
  }
  return await readExistingSchema(full);
}

/** Write a validated config with an optional leading `$schema`. */
// oxlint-disable-next-line typescript/promise-function-async -- thin writeFile wrapper, no awaiting needed
function writeConfigFile(
  full: string,
  config: StorybookConfig,
  schema: string | undefined,
): Promise<void> {
  return writeFile(full, `${JSON.stringify(withSchema(config, schema), null, 2)}\n`, "utf8");
}

/** `$schema` carried from the existing file, if any. */
async function readExistingSchema(configPath: string): Promise<string | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(configPath, "utf8"));
    if (typeof raw === "object" && raw !== null) {
      const schema = (raw as Record<string, unknown>)["$schema"];
      return typeof schema === "string" && schema.length > 0 ? schema : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Prepend `$schema` to a validated config for writing. */
function withSchema(
  config: StorybookConfig,
  schema: string | undefined,
): StorybookConfig & { $schema?: string } {
  return schema === undefined ? { ...config } : { $schema: schema, ...config };
}
