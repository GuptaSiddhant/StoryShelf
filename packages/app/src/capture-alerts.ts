/** Admin alerts for captures that leave their build failed; the app, not the capture child, sends them. */
import type { ShelfConfig, ShelfOptions } from "@storyshelf/core/config";
import type { Logger } from "@storyshelf/core/logger";
import { BuildModel } from "@storyshelf/core/models";
import { notifySystemWith } from "./notify.ts";

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
): Promise<void> {
  const build = await new BuildModel(options.database).get(buildId);
  if (build?.status !== "failed" || alreadyAlerted(build)) {
    return;
  }
  await notifySystemWith(
    {
      db: options.database,
      config,
      ui: options.ui ?? {},
      logger,
      notifiers: options.notifications?.notifiers ?? [],
      notificationsConfig: options.notifications?.config,
    },
    "sys:capture-failed",
    { buildId, projectId: build.projectId, gitBranch: build.gitBranch },
  );
}
