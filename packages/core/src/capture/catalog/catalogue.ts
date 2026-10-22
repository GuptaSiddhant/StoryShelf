/** Cataloguing a published build: read its Storybook index, persist `catalog.json` and component rows. */
import type { DatabaseAdapter } from "../../adapters/database.ts";
import type { StorageAdapter } from "../../adapters/storage.ts";
import { BuildComponentModel } from "../../models/build-component.ts";
import { catalogPath } from "../../utils/paths.ts";
import { groupComponents, toBuildComponent } from "./components.ts";
import { parseStorybookIndexText } from "./parse.ts";
import { readPublishedFile } from "./read.ts";
import type { Catalog, CatalogEntry } from "./types.ts";

/** What cataloguing reads and writes. */
export interface CatalogDeps {
  db: DatabaseAdapter;
  storage: StorageAdapter;
}

/** Index files a Storybook may publish, newest format first. */
const INDEX_FILES = ["index.json", "stories.json"] as const;

/**
 * Catalogue a build from its published statics: replace its `build_components` rows, then persist
 * `catalog.json`. Resolves to the catalog, or null when the build has no readable index
 * (statics purged, or not a Storybook), in which case nothing is written.
 */
export async function catalogueBuild(
  deps: CatalogDeps,
  projectId: string,
  buildId: string,
): Promise<Catalog | null> {
  const entries = await readIndexEntries(deps.storage, projectId, buildId);
  if (!entries) {
    return null;
  }
  const catalog: Catalog = { v: 1, entries };
  // The rows go first: catalog.json is the marker that cataloguing finished, so a crash between the
  // two leaves a build the lazy loader catalogues again, never one with a catalog and no rows.
  await new BuildComponentModel(deps.db).replaceForBuild(
    projectId,
    buildId,
    groupComponents(entries).map((component) => toBuildComponent(component)),
  );
  await deps.storage.write(catalogPath(projectId, buildId), Buffer.from(JSON.stringify(catalog)));
  return catalog;
}

/** A build's persisted catalog, or null when it has none (or an unreadable one). */
export async function readCatalog(
  storage: StorageAdapter,
  projectId: string,
  buildId: string,
): Promise<Catalog | null> {
  const path = catalogPath(projectId, buildId);
  try {
    if (!(await storage.exists(path))) {
      return null;
    }
    const parsed = JSON.parse((await storage.read(path)).toString("utf8")) as Partial<Catalog>;
    return parsed.v === 1 && Array.isArray(parsed.entries)
      ? { v: 1, entries: parsed.entries }
      : null;
  } catch {
    return null;
  }
}

async function readIndexEntries(
  storage: StorageAdapter,
  projectId: string,
  buildId: string,
): Promise<CatalogEntry[] | null> {
  for (const name of INDEX_FILES) {
    // eslint-disable-next-line no-await-in-loop -- stop at the first index that parses
    const file = await readPublishedFile(storage, projectId, buildId, name).catch(() => null);
    const entries = file ? parseStorybookIndexText(file.toString("utf8")) : null;
    if (entries) {
      return entries;
    }
  }
  return null;
}
