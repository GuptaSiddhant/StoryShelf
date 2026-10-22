/** Catalog entries grouped into components, hashed, and compared between builds. */
import { createHash } from "node:crypto";
import type { BuildComponentInput } from "../../models/build-component.ts";
import type { CatalogComponent, CatalogEntry } from "./types.ts";

/** Group entries by story file (entries without one by title), ordered by title then file. */
export function groupComponents(entries: readonly CatalogEntry[]): CatalogComponent[] {
  const groups = Map.groupBy(entries, (entry) => entry.importPath || `title:${entry.title}`);
  return [...groups.values()]
    .map((group): CatalogComponent => {
      const [first] = group;
      return {
        importPath: first?.importPath ?? "",
        title: first?.title ?? "",
        storyCount: group.filter((entry) => entry.type === "story").length,
        hash: hashEntries(group),
        entries: group,
      };
    })
    .toSorted((a, b) => a.title.localeCompare(b.title) || a.importPath.localeCompare(b.importPath));
}

/** What `build_components` stores of a component. */
export function toBuildComponent(component: CatalogComponent): BuildComponentInput {
  const { importPath, title, storyCount, hash } = component;
  return { importPath, title, storyCount, hash };
}

/** SHA-256 over the entries' id, name, type and title, in id order: equal sets hash equal. */
export function hashEntries(entries: readonly CatalogEntry[]): string {
  const lines = entries
    .map((entry) => [entry.id, entry.name, entry.type, entry.title].join("\t"))
    .toSorted();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** How one component's entries differ between two builds. */
export interface EntryChanges {
  added: number;
  removed: number;
  /** Same id, new display name. */
  renamed: number;
}

/** Entries added, removed and renamed from `before` to `after` (matched by entry id). */
export function diffEntries(
  before: readonly CatalogEntry[],
  after: readonly CatalogEntry[],
): EntryChanges {
  const was = new Map(before.map((entry) => [entry.id, entry] as const));
  const now = new Map(after.map((entry) => [entry.id, entry] as const));
  let renamed = 0;
  for (const [id, entry] of now) {
    if (was.has(id) && was.get(id)?.name !== entry.name) {
      renamed += 1;
    }
  }
  return {
    added: [...now.keys()].filter((id) => !was.has(id)).length,
    removed: [...was.keys()].filter((id) => !now.has(id)).length,
    renamed,
  };
}
