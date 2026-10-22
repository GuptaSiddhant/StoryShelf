import type { CatalogEntry } from "@storyshelf/core/capture";
import { normalizeImportPath } from "@storyshelf/core/models";
import type { Snapshot } from "@storyshelf/core/schema";

/** Tags Storybook adds on its own; they say nothing about the component. */
const STORYBOOK_TAGS: ReadonlySet<string> = new Set([
  "dev",
  "test",
  "autodocs",
  "play-fn",
  "manifest",
  "attached-mdx",
  "unattached-mdx",
]);

/** The library's unit: every entry that shares a title, grouped like Storybook's sidebar. */
export interface LibraryGroup {
  title: string;
  /** Story file of the first entry that has one; empty when the index names none. */
  importPath: string;
  stories: CatalogEntry[];
  /** Docs entries; the first is the component's docs page. */
  docs: CatalogEntry[];
  /** Tags worth showing, in first-seen order. */
  tags: string[];
}

/** Group catalog entries by title, ordered by title; stories keep index order. */
export function groupLibrary(entries: readonly CatalogEntry[]): LibraryGroup[] {
  const groups = Map.groupBy(entries, (entry) => entry.title);
  return [...groups.entries()]
    .map(([title, group]): LibraryGroup => {
      return {
        title,
        importPath: group.find((entry) => entry.importPath !== "")?.importPath ?? "",
        stories: group.filter((entry) => entry.type === "story"),
        docs: group.filter((entry) => entry.type === "docs"),
        tags: [...new Set(group.flatMap((entry) => entry.tags))].filter(
          (tag) => !STORYBOOK_TAGS.has(tag),
        ),
      };
    })
    .toSorted((a, b) => a.title.localeCompare(b.title));
}

/**
 * Entries rebuilt from a build's snapshots, for a captured build whose Storybook index is gone
 * (statics purged): the pages still list what was captured.
 */
export function entriesFromSnapshots(snapshots: readonly Snapshot[]): CatalogEntry[] {
  const seen = new Map<string, CatalogEntry>();
  for (const snap of snapshots) {
    if (!seen.has(snap.storyId)) {
      seen.set(snap.storyId, {
        id: snap.storyId,
        title: snap.storyTitle || "Untitled",
        name: snap.storyName,
        importPath: snap.storyImportPath ? normalizeImportPath(snap.storyImportPath) : "",
        type: "story",
        tags: [],
      });
    }
  }
  return [...seen.values()];
}
