/** Admin alerts for captures that leave their build failed; the app, not the capture child, sends them. */
import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { BuildModel, ProjectModel } from "@storyshelf/core/models";
import { notifyProjectWith, notifySystemWith } from "./notify.ts";

/**
 * Builds already alerted about, keyed by the build's last update. A sharded build settles one job
 * per shard and every one of them sees the failed build; only the first alerts. A retry rewrites
 * the build, so its next failure is a new key.
 */
const alerted = new Set<string>();

export function alreadyAlerted(build: { id: string; updatedAt: string }): boolean {
  const key = `${build.id}@${build.updatedAt}`;
  if (alerted.has(key)) {
    return true;
  }
  alerted.add(key);
  return false;
}

/** Alert admins when a capture leaves its build failed. */
export async function notifyCaptureFailed(
  options: ShelfOptions,
  config: ShelfConfig,
  logger: Logger,
  buildId: string,
  publicOrigin?: () => Promise<string | undefined>,
): Promise<void> {
  const build = await new BuildModel(options.database).get(buildId);
  if (build?.status !== "failed" || alreadyAlerted(build)) {
    return;
  }
  await sendCaptureAlert(options, config, logger, build, publicOrigin);
}

/**
 * Alert admins that a capture ended without its build being failed: the queue's exhausted-job hook
 * kept failing, so the build may still read `capturing`. Only the system alert goes out, since the
 * build did not fail by a verdict; a build already settled by someone else needs none.
 */
export async function notifyCaptureStuck(
  options: ShelfOptions,
  config: ShelfConfig,
  logger: Logger,
  buildId: string,
  publicOrigin?: () => Promise<string | undefined>,
): Promise<void> {
  const build = await new BuildModel(options.database).get(buildId);
  if (build === null || !["pending", "capturing", "failed"].includes(build.status)) {
    return;
  }
  if (alreadyAlerted(build)) {
    return;
  }
  await notifySystemWith(alertDeps(options, config, logger, publicOrigin), "sys:capture-failed", {
    buildId,
    projectId: build.projectId,
    gitBranch: build.gitBranch,
  });
}

function alertDeps(
  options: ShelfOptions,
  config: ShelfConfig,
  logger: Logger,
  publicOrigin?: () => Promise<string | undefined>,
): Parameters<typeof notifySystemWith>[0] {
  return {
    db: options.database,
    config,
    ui: options.ui ?? {},
    logger,
    notifiers: options.notifications?.notifiers ?? [],
    notificationsConfig: options.notifications?.config,
    publicOrigin: publicOrigin ? { url: publicOrigin } : undefined,
  };
}

async function sendCaptureAlert(
  options: ShelfOptions,
  config: ShelfConfig,
  logger: Logger,
  build: { id: string; projectId: string; gitBranch: string },
  publicOrigin?: () => Promise<string | undefined>,
): Promise<void> {
  const buildId = build.id;
  const deps = alertDeps(options, config, logger, publicOrigin);
  await notifySystemWith(deps, "sys:capture-failed", {
    buildId,
    projectId: build.projectId,
    gitBranch: build.gitBranch,
  });
  // Subscribers of the project's `build:failed` topic hear of a failed capture too.
  const project = await new ProjectModel(options.database).get(build.projectId);
  if (project) {
    await notifyProjectWith(
      deps,
      project,
      "build:failed",
      { buildId, status: "failed" },
      `/builds/${buildId}`,
    );
  }
}
