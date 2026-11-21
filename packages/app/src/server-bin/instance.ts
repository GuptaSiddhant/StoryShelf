import type { ShelfOptions } from "@storyshelf/core/config";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appsConstructed } from "../app-count.ts";
import type { ShelfApp, ShelfAppMode } from "../app-types.ts";
import { createShelfApp } from "../index.tsx";
import { isShelfInstance, type InstanceEnv, type ShelfInstance } from "../instance-definition.ts";

/** Entry filenames tried in order, relative to the instance directory, when nothing names the module. */
export const INSTANCE_ENTRIES = [
  "src/index.ts",
  "src/index.js",
  "src/index.mjs",
  "server.ts",
  "server.js",
  "server.mjs",
  "index.ts",
  "index.js",
  "index.mjs",
] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** `package.json#storyshelf.server` of `dir`, or undefined. */
async function configuredEntry(dir: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      storyshelf?: { server?: unknown };
    };
    const server = pkg.storyshelf?.server;
    return typeof server === "string" && server !== "" ? server : undefined;
  } catch {
    return undefined;
  }
}

/** The instance module: `--entry`, else `package.json#storyshelf.server`, else the first usual name. */
export async function resolveInstanceEntry(dir: string, entry?: string): Promise<string> {
  const named = entry ?? (await configuredEntry(dir));
  if (named !== undefined) {
    const file = resolve(dir, named);
    if (await exists(file)) return file;
    throw new Error(
      `Instance module ${file} does not exist (${entry === undefined ? "package.json#storyshelf.server" : "--entry"}).`,
    );
  }
  for (const candidate of INSTANCE_ENTRIES) {
    const full = join(dir, candidate);
    // oxlint-disable-next-line no-await-in-loop -- probe candidates in order, return the first hit
    if (await exists(full)) return full;
  }
  throw new Error(
    `No instance module in ${dir}. Pass --entry <file>, set "storyshelf": { "server": "<file>" } in package.json, or use one of ${INSTANCE_ENTRIES.join(", ")}.`,
  );
}

/** Whether `value` has the shape of a created app: a fetch handler and a lifecycle. */
export function isShelfApp(value: unknown): value is ShelfApp {
  const candidate = value as { fetch?: unknown; lifecycle?: { setup?: unknown } } | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.fetch === "function" &&
    typeof candidate.lifecycle?.setup === "function"
  );
}

/** A loaded instance module: its definition, its path and how many apps existed before it loaded. */
export interface LoadedInstance {
  instance: ShelfInstance;
  entry: string;
  /** Apps constructed in this process before the module was imported. */
  appsBefore: number;
}

const CONTRACT =
  "Export `defineShelfInstance(async (env) => options)` from @storyshelf/app: the instance module exports configuration, and `storyshelf-server` creates the app for the command it runs.";

/**
 * Import the instance module and take its definition (the default export). A module that exports a
 * constructed app, or built one while importing, is refused: its app would have set up, migrated
 * and started its consumer before the bin knew which command runs.
 */
export async function loadInstance(dir: string, entry?: string): Promise<LoadedInstance> {
  const file = await resolveInstanceEntry(resolve(dir), entry);
  const appsBefore = appsConstructed();
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown; app?: unknown };
  if (isShelfApp(mod.default) || isShelfApp(mod.app)) {
    throw new Error(`${file} exports a constructed app. ${CONTRACT}`);
  }
  if (appsConstructed() > appsBefore) {
    throw new Error(`${file} constructed an app while loading. ${CONTRACT}`);
  }
  if (!isShelfInstance(mod.default)) {
    throw new Error(`${file} has no instance definition as its default export. ${CONTRACT}`);
  }
  return { instance: mod.default, entry: file, appsBefore };
}

/** An instance ready to run a command: the app in its mode, and the options the factory returned. */
export interface BuiltInstance extends LoadedInstance {
  app: ShelfApp;
  options: ShelfOptions;
}

/**
 * Call the factory, then create the one app of this process in `mode`. The factory runs after the
 * bin loaded `.env`; it may throw (a missing setting), which the caller reports. An app built before
 * this one (by the factory or an import) fails the run.
 */
export async function buildInstance(
  loaded: LoadedInstance,
  mode: ShelfAppMode,
  env: InstanceEnv,
): Promise<BuiltInstance> {
  const options = await loaded.instance.factory(env);
  if (appsConstructed() !== loaded.appsBefore) {
    throw new Error(`${loaded.entry} constructed an app besides the bin's. ${CONTRACT}`);
  }
  return { ...loaded, options, app: createShelfApp(options, { mode }) };
}
