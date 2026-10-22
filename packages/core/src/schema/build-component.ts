/**
 * Row type of `build_components` (ADR 0006, decision 9): one row per component of a published
 * build, written from the build's Storybook index when publishing ends. A component is the
 * stories and docs entries that share a story file (`importPath`).
 */

/** One component of one build, as persisted from the Storybook index. */
export interface BuildComponent {
  id: string;
  projectId: string;
  buildId: string;
  /** Story file the component's entries come from, without a leading `./`; empty when the index has none. */
  importPath: string;
  title: string;
  /** Story entries (docs entries are not counted). */
  storyCount: number;
  /** SHA-256 of the component's entries (id, name, type), so two builds compare with one string. */
  hash: string;
  createdAt: string;
}
