/** Storybook index to catalog entries: `index.json` (v4/v5), `stories.json` (v3 and older). */
import { normalizeImportPath } from "../../models/design-resolve.ts";
import type { CatalogEntry } from "./types.ts";

/**
 * Entries of a parsed index document, or null when it is not an index. Test entries (Storybook 10
 * `subtype: "test"`) are left out, as capture leaves them out; entries without an id or title are
 * skipped, never an error.
 */
export function parseStorybookIndex(document: unknown): CatalogEntry[] | null {
  if (typeof document !== "object" || document === null) {
    return null;
  }
  const record = document as { entries?: unknown; stories?: unknown };
  const table = [record.entries, record.stories].find((value) => isRecord(value));
  if (!table) {
    return null;
  }
  return Object.values(table).flatMap((raw) => {
    const entry = toEntry(raw);
    return entry ? [entry] : [];
  });
}

/** Parse the text of an index file; null when it is not JSON or not an index. */
export function parseStorybookIndexText(text: string): CatalogEntry[] | null {
  try {
    return parseStorybookIndex(JSON.parse(text));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** One raw entry; every field is optional on old Storybooks, so each is read defensively. */
function toEntry(raw: unknown): CatalogEntry | null {
  if (!isRecord(raw) || raw["subtype"] === "test") {
    return null;
  }
  const id = str(raw["id"]);
  const title = str(raw["title"]) ?? str(raw["kind"]);
  if (!id || !title) {
    return null;
  }
  const importPath = str(raw["importPath"]);
  const tags = raw["tags"];
  return {
    id,
    title,
    name: str(raw["name"]) ?? str(raw["story"]) ?? id,
    importPath: importPath ? normalizeImportPath(importPath) : "",
    type: raw["type"] === "docs" ? "docs" : "story",
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [],
  };
}
