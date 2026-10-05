import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Locate a vendored file under `assets/` for the three layouts the app runs in:
 * - from source / the published library build, `assets/` sits next to the module;
 * - in the bundled Fly server (`dist/server.mjs`) it sits one level up
 *   (`/app/assets`, copied by the Dockerfile).
 * Throws with every path tried, since a missing file is a packaging bug.
 */
export function findAsset(
  name: string,
  from: string | URL,
  exists: (path: string) => boolean = existsSync,
): string {
  const candidates = [`assets/${name}`, `../assets/${name}`].map((relative) =>
    fileURLToPath(new URL(relative, from)),
  );
  const found = candidates.find((path) => exists(path));
  if (!found) {
    throw new Error(`Vendored asset "${name}" not found. Looked in: ${candidates.join(", ")}`);
  }
  return found;
}
