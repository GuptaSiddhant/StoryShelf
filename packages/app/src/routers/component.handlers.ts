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
import type { ComponentPageData, ComponentTab } from "../pages/component-detail.tsx";
import type { DesignItem } from "../pages/design-links.tsx";
import { getStore } from "../store.ts";
import {
  designUrlsFor,
  loadDesignResolutions,
  loadReviewDesign,
  returnPathOf,
} from "./design.handlers.ts";
import { linkedUsageFor } from "./links.handlers.ts";

/** Latest build the library shows: newest on the default branch, else the newest at all. */
async function latestBuildOf(projectId: string, defaultBranch: string): Promise<Build | undefined> {
  const builds = new BuildModel(getStore().db);
  return (
    (await builds.list(projectId, { branch: defaultBranch }))[0] ??
    (await builds.list(projectId))[0]
  );
}

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
  data: Pick<ComponentPageData, "project" | "shownBuild">,
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

/** History, states and tombstone presence of a story file; null when it was never captured. */
async function loadComponentCore(
  project: Project,
  importPath: string,
): Promise<
  | (Pick<ComponentPageData, "shownBuild" | "title" | "groups" | "history" | "presence"> & {
      states: Snapshot[];
    })
  | null
> {
  const { db } = getStore();
  const snapshots = await new SnapshotModel(db).listByImportPath(project.id, importPath);
  const history = componentHistory(snapshots, await buildsOf(snapshots));
  const shownBuild = history[0]?.build;
  if (!shownBuild) return null;
  const states = snapshots.filter((snap) => snap.buildId === shownBuild.id);
  const latest = await latestBuildOf(project.id, project.gitDefaultBranch);
  const latestSnapshots = latest ? await new SnapshotModel(db).listByBuild(latest.id) : [];
  const title = states[0]?.storyTitle ?? importPath;
  return {
    shownBuild,
    title,
    states,
    groups: groupSnapshots(states),
    history,
    presence: componentPresence(history, latest?.id ?? null, latestSnapshots, title),
  };
}

/**
 * Load a component page by story-file path, or null when the project or file
 * is unknown. Moved/deleted files still load, carrying a tombstone presence.
 */
export async function loadComponentPage(
  c: Context,
  slug: string,
  rawPath: string,
  tab: ComponentTab,
): Promise<ComponentPageData | null> {
  const project = await new ProjectModel(getStore().db).getBySlug(slug);
  const importPath = normalizeImportPath(rawPath);
  const core = project && importPath ? await loadComponentCore(project, importPath) : null;
  if (!project || !core) return null;
  const { states, ...rest } = core;
  return {
    ...rest,
    project,
    importPath,
    tab,
    publishedBaseDomain: getStore().config.publishedBaseDomain,
    ...(await loadTabData(c, { project, shownBuild: core.shownBuild }, tab, states)),
  };
}
