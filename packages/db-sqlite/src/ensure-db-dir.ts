import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Create the parent directory of a database file so a fresh checkout or an
 * empty volume boots without a manual `mkdir` (SQLite creates the file but
 * never its directory). In-memory databases and `file:` URIs are left alone.
 */
export function ensureDbDir(path: string): void {
  if (path === "" || path === ":memory:" || path.startsWith("file:")) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
}
