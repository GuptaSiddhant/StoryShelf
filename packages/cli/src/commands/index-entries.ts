import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Index files in the order the server reads them: `index.json` (v4/v5), then `stories.json`. */
const INDEX_FILES = ["index.json", "stories.json"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The entry id of one raw index entry, or null where the server's catalog would leave it out. */
function entryId(raw: unknown): string | null {
  if (!isRecord(raw) || raw["subtype"] === "test") return null;
  const id = str(raw["id"]);
  return id && (str(raw["title"]) ?? str(raw["kind"])) ? id : null;
}

/** Entry ids of one parsed index document, or null when it is not an index. */
function idsOf(document: unknown): string[] | null {
  if (!isRecord(document)) return null;
  const table = [document["entries"], document["stories"]].find((value) => isRecord(value));
  if (!table) return null;
  return Object.values(table).flatMap((raw) => {
    const id = entryId(raw);
    return id === null ? [] : [id];
  });
}

/**
 * The entry ids of the built Storybook's index, the way the server's catalog counts them (story
 * and docs entries, never test entries). Null when no index file parses, so the caller uploads.
 */
export function readEntryIds(cwd: string, buildDir: string): string[] | null {
  for (const name of INDEX_FILES) {
    try {
      const ids = idsOf(JSON.parse(readFileSync(join(resolve(cwd, buildDir), name), "utf8")));
      if (ids) return ids;
    } catch {
      // Not there or not JSON: try the next file.
    }
  }
  return null;
}
