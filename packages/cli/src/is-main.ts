import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Whether the module at `metaUrl` is the process entrypoint. Resolves symlinks
 * in `argv[1]`: npm/npx launch bins through a `.bin/<name>` symlink, so a plain
 * `pathToFileURL(argv[1])` comparison never matches and the CLI would exit
 * silently without parsing its arguments.
 */
export function isMainModule(metaUrl: string, argv1?: string): boolean {
  if (!argv1) {
    return false;
  }
  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return metaUrl === pathToFileURL(argv1).href;
  }
}
