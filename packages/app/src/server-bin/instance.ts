import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ShelfApp } from "../app-types.ts";

/** Entry filenames tried in order, relative to the instance directory. */
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

/** The first instance entry that exists in `dir`. */
export async function resolveInstanceEntry(dir: string): Promise<string> {
  for (const candidate of INSTANCE_ENTRIES) {
    const full = join(dir, candidate);
    try {
      // oxlint-disable-next-line no-await-in-loop -- probe candidates in order, return the first hit
      await access(full);
      return full;
    } catch {
      continue;
    }
  }
  throw new Error(
    `No instance module in ${dir} (looked for ${INSTANCE_ENTRIES.join(", ")}). Run it in the instance project, or pass --dir.`,
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

/** A loaded instance: its app and the module it came from. */
export interface Instance {
  app: ShelfApp;
  entry: string;
}

/**
 * Import the instance module of `dir` and take its app: the default export, or a named `app`.
 * Importing builds the app (adapters are created, nothing is set up and no port opens).
 */
export async function loadInstance(dir: string): Promise<Instance> {
  const entry = await resolveInstanceEntry(resolve(dir));
  const mod = (await import(pathToFileURL(entry).href)) as { default?: unknown; app?: unknown };
  const app = [mod.default, mod.app].find((candidate) => isShelfApp(candidate));
  if (!app) {
    throw new Error(
      `${entry} does not export the app. Use \`export default createShelfApp({ ... })\` and leave listening to \`storyshelf-server serve\`.`,
    );
  }
  return { app, entry };
}
