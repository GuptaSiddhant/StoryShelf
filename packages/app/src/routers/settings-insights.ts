import { BuildModel, SnapshotModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import { loadHealthPanel } from "../insights/health-panel.ts";
import { a11ySummaryOf } from "../pages/a11y-violations.tsx";
import type { QueueView } from "../pages/compute-jobs.tsx";
import { captureTimingsOf, queueViewOf, type StorageUsageView } from "../pages/insights-model.ts";
import type { SettingsInsightsData } from "../pages/settings-insights.tsx";
import { getStore, testingEnabled } from "../store.ts";
import { currentProjectRole } from "./helpers.ts";

/** The captures queued or running for one project (the queue is shared by every project; empty without a queue). */
export async function getQueueView(projectId: string): Promise<QueueView[]> {
  const queue = getStore().captureQueue;
  if (!queue) {
    return [];
  }
  const owned = new Set(
    (await new BuildModel(getStore().db).list(projectId)).map((build) => build.id),
  );
  return queueViewOf(await queue.active(), owned);
}

/** Whether the viewer may retry the project's captures. */
export async function canManageJobs(projectId: string): Promise<boolean> {
  const { authEnabled } = getStore();
  if (!authEnabled) {
    return true;
  }
  const roles: readonly ProjectRole[] = ["developer", "approver", "admin"];
  const role = await currentProjectRole(projectId);
  return Boolean(role && roles.includes(role));
}

/** The newest build that rendered something here (inherited snapshots carry no time of their own). */
function newestCaptured(builds: readonly Build[]): Build | undefined {
  return builds.find((build) => build.snapshotCount > build.inheritedCount);
}

async function loadLatest(builds: Build[]): Promise<SettingsInsightsData["latest"]> {
  const build = newestCaptured(builds);
  if (!build) {
    return null;
  }
  const snapshots = await new SnapshotModel(getStore().db).listByBuild(build.id);
  return { build, timings: captureTimingsOf(snapshots), a11y: a11ySummaryOf(snapshots) };
}

/** The weight of the project's live published content, from the sizes the database recorded; null when the adapter cannot say. */
async function loadStorage(projectId: string): Promise<StorageUsageView | null> {
  const lifecycle = getStore().db.buildReferenceLifecycle;
  return lifecycle ? await lifecycle.contentUsage(projectId) : null;
}

/**
 * What the Insights tab shows. The capture numbers and the jobs list load only for the Insights
 * tab itself and with testing on; any other tab asks with `full: false` just to know whether to
 * show the tab.
 */
export async function loadSettingsInsights(
  project: Project,
  full: boolean,
): Promise<SettingsInsightsData> {
  const health = await loadHealthPanel(project);
  const storage = full ? await loadStorage(project.id) : null;
  if (!full || !testingEnabled()) {
    return {
      builds: [],
      testing: testingEnabled(),
      health,
      latest: null,
      queue: [],
      canRetry: false,
      storage,
    };
  }
  const builds = await new BuildModel(getStore().db).list(project.id);
  return {
    builds,
    testing: true,
    health,
    latest: await loadLatest(builds),
    queue: await getQueueView(project.id),
    canRetry: await canManageJobs(project.id),
    storage,
  };
}
