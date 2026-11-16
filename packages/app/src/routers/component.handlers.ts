import { contentHostSuffix } from "@storyshelf/core/config";
import {
  BuildModel,
  componentHistory,
  componentPresence,
  type ComponentHistoryRow,
  type ComponentPresence,
  normalizeImportPath,
  ProjectModel,
  SnapshotModel,
} from "@storyshelf/core/models";
import type { Build, Project, Snapshot } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { groupSnapshots } from "../pages/build-diff-model.ts";
import {
  componentTabs,
  type BuildSelection,
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
import { previewBaseOf } from "./preview-base.ts";
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
  /** The newest build that has the file: what the page shows when no build is requested. */
  defaultBuildId: string;
}

/** History, states and tombstone presence of a story file from its snapshots. */
async function loadCaptured(
  project: Project,
  importPath: string,
  requested?: Build,
): Promise<CapturedLoad | null> {
  const { db } = getStore();
  const snapshots = await new SnapshotModel(db).listByImportPath(project.id, importPath);
  const history = componentHistory(snapshots, await buildsOf(snapshots));
  const [newest] = history;
  // A requested build that has no states of the file shows none; it never falls back to another.
  const shownBuild = shownBuildOf(history, requested);
  if (!newest || !shownBuild) return null;
  const states = snapshots.filter((snap) => snap.buildId === shownBuild.id);
  const title = states[0]?.storyTitle ?? importPath;
  return {
    states,
    title,
    defaultBuildId: newest.build.id,
    captured: {
      shownBuild,
      groups: groupSnapshots(states),
      history,
      presence: await presenceOf(project, history, title),
    },
  };
}

/** Whether the file is in, moved from or gone from the project's latest build. */
async function presenceOf(
  project: Project,
  history: ComponentHistoryRow[],
  title: string,
): Promise<ComponentPresence> {
  const latest = await latestProjectBuild(project);
  const latestSnapshots = latest
    ? await new SnapshotModel(getStore().db).listByBuild(latest.id)
    : [];
  return componentPresence(history, latest?.id ?? null, latestSnapshots, title);
}

/** The build whose states the page shows: the requested one when it has any, else the newest. */
function shownBuildOf(
  history: readonly { build: Build }[],
  requested: Build | undefined,
): Build | undefined {
  return requested
    ? history.find((row) => row.build.id === requested.id)?.build
    : history[0]?.build;
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
  requestedBuild?: string,
): Promise<ComponentPageData | null> {
  const project = await new ProjectModel(getStore().db).getBySlug(slug);
  const importPath = normalizeImportPath(rawPath);
  if (!project || !importPath) return null;
  const requested = await requestedBuildOf(project, requestedBuild);
  // An explicit build that is not this project's is a 404, never a fallback to the newest build.
  if (requested === null) return null;
  const sources = await loadSources(project, importPath, requested);
  if (!sources) return null;
  const { captured, view } = sources;
  const tabbed = await loadTab(c, project, captured, requestedTab);
  return {
    project,
    importPath,
    title: captured?.title ?? view.title,
    testing: testingEnabled(),
    catalog: view,
    captured: captured?.captured ?? null,
    selection: requested ? selectionOf(requested, captured, view) : null,
    story,
    previewBase: await previewBaseOf(project, view.build),
    publishedBaseDomain: contentHostSuffix(getStore().config),
    review: await loadComponentReview(project, view.build),
    ...tabbed,
  };
}

/** The open tab, and the data only that tab needs. */
async function loadTab(
  c: Context,
  project: Project,
  captured: CapturedLoad | null,
  requestedTab: string | undefined,
): Promise<Pick<ComponentPageData, "tab" | "design" | "usage">> {
  const tab = resolveTab(requestedTab, testingEnabled(), captured !== null);
  const data = captured
    ? await loadTabData(
        c,
        { project, shownBuild: captured.captured.shownBuild },
        tab,
        captured.states,
      )
    : { design: [], usage: [] };
  return { tab, ...data };
}

/** The captured snapshots (with `testing`) and the catalog view of a file; null when it is unknown. */
async function loadSources(
  project: Project,
  importPath: string,
  requested: Build | undefined,
): Promise<{ captured: CapturedLoad | null; view: ComponentCatalogView } | null> {
  const [captured, catalog] = await Promise.all([
    testingEnabled() ? loadCaptured(project, importPath, requested) : Promise.resolve(null),
    loadCatalogView(project, importPath, requested).catch(() => null),
  ]);
  const view =
    catalog ??
    (captured ? viewOfCaptured(captured) : null) ??
    (await absentView(project, importPath, requested));
  return view ? { captured, view } : null;
}

/**
 * The build `?build=` names: undefined without the parameter, null when it is not one of this
 * project's builds (the page then answers 404 like any other hidden resource).
 */
async function requestedBuildOf(
  project: Project,
  id: string | undefined,
): Promise<Build | null | undefined> {
  if (id === undefined || id === "") return undefined;
  const build = await new BuildModel(getStore().db).get(id);
  return build?.projectId === project.id ? build : null;
}

/** Which build the page was asked to show, whether it is the newest, and whether it holds the file. */
function selectionOf(
  build: Build,
  loaded: CapturedLoad | null,
  view: ComponentCatalogView,
): BuildSelection {
  return {
    build,
    newest: build.id === (loaded?.defaultBuildId ?? view.defaultBuildId),
    present: loaded !== null || view.entries.length > 0,
  };
}

/**
 * The view of a valid build that does not hold a file captured elsewhere: no stories, titled as
 * its newest capture. Null without a requested build or when no build ever captured the file.
 */
async function absentView(
  project: Project,
  importPath: string,
  requested: Build | undefined,
): Promise<ComponentCatalogView | null> {
  const elsewhere = requested && testingEnabled() ? await loadCaptured(project, importPath) : null;
  return requested && elsewhere
    ? { ...viewOfCaptured(elsewhere), build: requested, entries: [] }
    : null;
}

/** A catalog view for a captured file whose published index is gone: its snapshots stand in. */
function viewOfCaptured(loaded: CapturedLoad): ComponentCatalogView {
  return {
    build: loaded.captured.shownBuild,
    defaultBuildId: loaded.defaultBuildId,
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
