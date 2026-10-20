/** Storage keys for local files: `/`-separated on every host. */
import { sep } from "node:path";

/**
 * A listed file's storage key. Keys are always `/`-separated, whatever the host's path separator,
 * so `list()` returns the same strings `write()` was given and the database stores (on Windows,
 * `relative()` yields `p1\content\x.png`, which would match no reference).
 */
export function storageKey(relativePath: string, separator: string = sep): string {
  return relativePath.split(separator).join("/");
}
