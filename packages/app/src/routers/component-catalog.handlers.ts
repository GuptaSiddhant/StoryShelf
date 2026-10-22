import {
  catalogPresence,
  componentBuildHistory,
  diffEntries,
  type CatalogEntry,
  type ComponentBuildRow,
  type EntryChanges,
} from "@storyshelf/core/capture";
import { BuildComponentModel, BuildModel } from "@storyshelf/core/models";
import type { ComponentPresence } from "@storyshelf/core/models";
import type { Build, BuildComponent, Project } from "@storyshelf/core/schema";
import { catalogOf, getStore } from "../store.ts";

/** Newest builds a component's history lists. */
const HISTORY_LIMIT = 50;

/** Changed rows whose added/removed/renamed counts are worked out (each loads two catalogs). */
const DETAIL_LIMIT = 10;

/** A build of the component's history, with what changed in its stories when known. */
export interface CatalogHistoryRow extends ComponentBuildRow {
  changes: EntryChanges | null;
}

/** What the catalog knows of a component (ADR 0006, decision 9); the same with `testing` on or off. */
export interface ComponentCatalogView {
  /** The build the Stories tab shows: newest on the default branch holding the file, else newest. */
  build: Build;
  title: string;
  /** The file's stories and docs entries in that build. */
  entries: CatalogEntry[];
  history: CatalogHistoryRow[];
  presence: ComponentPresence;
}

/** Newest build on the default branch, else the newest at all; the library's own choice. */
export async function latestProjectBuild(project: Project): Promise<Build | undefined> {
  const builds = new BuildModel(getStore().db);
  return (
    (await builds.list(project.id, { branch: project.gitDefaultBranch, limit: 1 }))[0] ??
    (await builds.list(project.id, { limit: 1 }))[0]
  );
}

/**
 * The catalog view of a story file, or null when no published build holds it. The latest build is
 * catalogued first (lazily, when it predates the catalog) so presence can be told.
 */
export async function loadCatalogView(
  project: Project,
  importPath: string,
): Promise<ComponentCatalogView | null> {
  const latest = await latestProjectBuild(project);
  const latestRows = latest ? await catalogueLatest(project, latest) : [];
  const rows = await new BuildComponentModel(getStore().db).listByImportPath(
    project.id,
    importPath,
  );
  const history = componentBuildHistory(rows, await buildsOf(rows)).slice(0, HISTORY_LIMIT);
  const shown =
    history.find((entry) => entry.build.gitBranch === project.gitDefaultBranch) ?? history[0];
  if (!shown) {
    return null;
  }
  return {
    build: shown.build,
    title: shown.component.title,
    entries: await entriesOf(project.id, shown.build.id, importPath),
    history: await withChanges(project.id, importPath, history),
    presence: catalogPresence(history, importPath, latestRows.length > 0 ? latestRows : null),
  };
}

/** Catalogue the latest build when it has no catalog yet; its component rows. */
async function catalogueLatest(project: Project, latest: Build): Promise<BuildComponent[]> {
  await catalogOf()
    .load(project.id, latest.id)
    .catch(() => null);
  return await new BuildComponentModel(getStore().db).listByBuild(latest.id);
}

async function buildsOf(rows: readonly BuildComponent[]): Promise<Build[]> {
  const model = new BuildModel(getStore().db);
  const found = await Promise.all(
    [...new Set(rows.map((row) => row.buildId))].map(async (id) => await model.get(id)),
  );
  return found.filter((build): build is Build => build !== null);
}

/** A file's entries in one build's catalog; empty when the catalog cannot be read. */
async function entriesOf(
  projectId: string,
  buildId: string,
  importPath: string,
): Promise<CatalogEntry[]> {
  const catalog = await catalogOf()
    .load(projectId, buildId)
    .catch(() => null);
  return (catalog?.entries ?? []).filter((entry) => entry.importPath === importPath);
}

/** Add added/removed/renamed counts to the newest changed rows. */
async function withChanges(
  projectId: string,
  importPath: string,
  history: readonly ComponentBuildRow[],
): Promise<CatalogHistoryRow[]> {
  let budget = DETAIL_LIMIT;
  return await Promise.all(
    history.map(async (row): Promise<CatalogHistoryRow> => {
      if (row.change !== "changed" || !row.previous || budget <= 0) {
        return { ...row, changes: null };
      }
      budget -= 1;
      const [before, after] = await Promise.all([
        entriesOf(projectId, row.previous.buildId, importPath),
        entriesOf(projectId, row.build.id, importPath),
      ]);
      return { ...row, changes: diffEntries(before, after) };
    }),
  );
}
