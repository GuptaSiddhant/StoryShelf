/** Shapes of the persisted catalog (ADR 0006, decision 9). */

/** One Storybook index entry, kept compact: story and docs entries, never test entries. */
export interface CatalogEntry {
  id: string;
  title: string;
  name: string;
  /** Story file without a leading `./`; empty when the index carries none. */
  importPath: string;
  type: "story" | "docs";
  tags: string[];
}

/** A build's catalog as stored in `catalog.json`. */
export interface Catalog {
  /** Format version of the file. */
  v: 1;
  entries: CatalogEntry[];
}

/** The entries of one story file, with what `build_components` stores of them. */
export interface CatalogComponent {
  importPath: string;
  title: string;
  /** Story entries; docs entries are not counted. */
  storyCount: number;
  /** SHA-256 over the component's entries, so two builds compare with one string. */
  hash: string;
  entries: CatalogEntry[];
}
