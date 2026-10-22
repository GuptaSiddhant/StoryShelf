/**
 * The Storybook catalog (ADR 0006, decision 9): what a published build holds, read from its
 * `index.json` when publishing ends, kept as `catalog.json` plus one `build_components` row per
 * component, and loaded lazily for builds that predate it.
 */
export { createCatalogHook } from "./hook.ts";
export {
  createCatalogLoader,
  DEFAULT_CATALOG_CACHE_SIZE,
  type CatalogLoader,
  type CatalogLoaderOptions,
} from "./load.ts";
export { catalogueBuild, readCatalog, type CatalogDeps } from "./catalogue.ts";
export {
  diffEntries,
  groupComponents,
  hashEntries,
  toBuildComponent,
  type EntryChanges,
} from "./components.ts";
export { parseStorybookIndex, parseStorybookIndexText } from "./parse.ts";
export { readPublishedFile } from "./read.ts";
export type { Catalog, CatalogComponent, CatalogEntry } from "./types.ts";
export {
  catalogPresence,
  componentBuildHistory,
  type ComponentBuildRow,
  type ComponentChange,
} from "./history.ts";
