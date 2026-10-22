import {
  BuildModel,
  componentHistory,
  componentPresence,
  normalizeImportPath,
  ProjectModel,
  SnapshotModel,
} from "@storyshelf/core/models";
import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { groupSnapshots } from "../pages/build-diff-model.ts";
import {
  componentTabs,
  type CapturedComponent,
  type ComponentPageData,
  type ComponentTab,
} from "../pages/component-detail.tsx";
import type { DesignItem } from "../pages/design-links.tsx";
import { entriesFromSnapshots } from "../pages/library-model.ts";
import { getStore, testingEnabled } from "../store.ts";
import {
  latestProjectBuild,
  loadCatalogView,
  type ComponentCatalogView,
} from "./component-catalog.handlers.ts";
import {
  designUrlsFor,
  loadDesignResolutions,
  loadReviewDesign,
  returnPathOf,
} from "./design.handlers.ts";
import { linkedUsageFor } from "./links.handlers.ts";
import { isAnonymouslyViewable } from "./preview-access.ts";
import { loadComponentReview } from "./review-section.handlers.ts";

async function buildsOf(snapshots: readonly Snapshot[]): Promise<Build[]> {
  const model = new BuildModel(getStore().db);
  const found = await Promise.all(
    [...new Set(snapshots.map((snap) => snap.buildId))].map(async (id) => await model.get(id)),
  );
  return found.filter((build): build is Build => build !== null);
}

/** Design links of a component's first state, with cached metadata and connect offers. */
async function loadDesignTab(
  c: Context,
  project: ComponentPageData["project"],
  states: Snapshot[],
): Promise<DesignItem[]> {
  const [first] = states;
  if (!first) return [];
  const urls = designUrlsFor(await loadDesignResolutions(project, states), first);
  return await loadReviewDesign(project, first, urls, returnPathOf(c)).catch(() => []);
}

/** Tab-specific data (design strip or linked packages), loaded only when its tab is open. */
async function loadTabData(
  c: Context,
  data: { project: Project; shownBuild: Build },
  tab: ComponentTab,
  states: Snapshot[],
): Promise<Pick<ComponentPageData, "design" | "usage">> {
  const [first] = states;
  if (!first) return { design: [], usage: [] };
  if (tab === "design") return { design: await loadDesignTab(c, data.project, states), usage: [] };
  if (tab === "linked") {
    const usage = await linkedUsageFor(
      c,
      data.project,
      data.shownBuild.id,
      first.storyImportPath,
    ).catch(() => []);
    return { design: [], usage };
  }
  return { design: [], usage: [] };
}

/** What a story file's captured snapshots give the page; null when it was never captured. */
interface CapturedLoad {
  captured: CapturedComponent;
  /** The shown build's snapshots of the file (they drive the Design and Linked tabs). */
  states: Snapshot[];
  /** Title of the newest snapshot (retitles update in place). */
  title: string;
}

/** History, states and tombstone presence of a story file from its snapshots. */
async function loadCaptured(project: Project, importPath: string): Promise<CapturedLoad | null> {
  const { db } = getStore();
  const snapshots = await new SnapshotModel(db).listByImportPath(project.id, importPath);
  const history = componentHistory(snapshots, await buildsOf(snapshots));
  const shownBuild = history[0]?.build;
  if (!shownBuild) return null;
  const states = snapshots.filter((snap) => snap.buildId === shownBuild.id);
  const latest = await latestProjectBuild(project);
  const latestSnapshots = latest ? await new SnapshotModel(db).listByBuild(latest.id) : [];
  const title = states[0]?.storyTitle ?? importPath;
  return {
    states,
    title,
    captured: {
      shownBuild,
      groups: groupSnapshots(states),
      history,
      presence: componentPresence(history, latest?.id ?? null, latestSnapshots, title),
    },
  };
}

/**
 * Load a component page by story-file path, or null when the project or file is unknown. The
 * catalog gives the page its skeleton in both modes; with `testing`, captured snapshots are layered
 * on. Moved/deleted files still load, carrying a tombstone presence.
 */
export async function loadComponentPage(
  c: Context,
  slug: string,
  rawPath: string,
  requestedTab: string | undefined,
  story?: string,
): Promise<ComponentPageData | null> {
  const project = await new ProjectModel(getStore().db).getBySlug(slug);
  const importPath = normalizeImportPath(rawPath);
  if (!project || !importPath) return null;
  const testing = testingEnabled();
  const [loaded, catalog] = await Promise.all([
    testing ? loadCaptured(project, importPath) : Promise.resolve(null),
    loadCatalogView(project, importPath).catch(() => null),
  ]);
  const view = catalog ?? (loaded ? viewOfCaptured(loaded) : null);
  if (!view) return null;
  const tab = resolveTab(requestedTab, testing, loaded !== null);
  const tabData = loaded
    ? await loadTabData(c, { project, shownBuild: loaded.captured.shownBuild }, tab, loaded.states)
    : { design: [], usage: [] };
  return {
    project,
    importPath,
    title: loaded?.title ?? view.title,
    tab,
    testing,
    catalog: view,
    captured: loaded?.captured ?? null,
    story,
    previewable: isAnonymouslyViewable(view.build, project),
    publishedBaseDomain: getStore().config.publishedBaseDomain,
    review: await loadComponentReview(project, view.build),
    ...tabData,
  };
}

/** A catalog view for a captured file whose published index is gone: its snapshots stand in. */
function viewOfCaptured(loaded: CapturedLoad): ComponentCatalogView {
  return {
    build: loaded.captured.shownBuild,
    title: loaded.title,
    entries: entriesFromSnapshots(loaded.states),
    history: [],
    presence: loaded.captured.presence,
  };
}

/** The requested tab when this page offers it; else States once captured, Stories otherwise. */
function resolveTab(
  requested: string | undefined,
  testing: boolean,
  captured: boolean,
): ComponentTab {
  const tabs = componentTabs(testing);
  const found = tabs.find((candidate) => candidate === requested);
  return found ?? (testing && captured ? "states" : "stories");
}
