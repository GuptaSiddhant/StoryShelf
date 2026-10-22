/** Lazy, cached loader for the axe-core browser bundle. */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

let cached: Promise<string> | undefined;

/**
 * Read `axe.min.js` (~550 KB) once per process, on first use. Lazy on purpose: servers that never run
 * accessibility checks do not touch the file at boot. A failed read is not cached.
 */
export async function loadAxeSource(): Promise<string> {
  cached ??= readAxeSource();
  try {
    return await cached;
  } catch (error) {
    cached = undefined;
    throw error;
  }
}

/**
 * Wrap the axe source so evaluating it twice in one document is a no-op. Evaluate it as a string
 * (CDP `Runtime.evaluate`: not bound by the page's CSP and works over remote browsers, since the
 * source travels over the wire instead of a file path).
 */
export function axeInjectionScript(source: string): string {
  return `(function(){if(typeof globalThis.axe!=="undefined")return;\n${source}\n})()`;
}

/** Drop the cached source (tests). */
export function resetAxeSourceCache(): void {
  cached = undefined;
}

async function readAxeSource(): Promise<string> {
  const path = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
  return await readFile(path, "utf8");
}
