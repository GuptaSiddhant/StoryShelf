import { BuildModel, CaptureAttemptModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { getStore } from "../store.ts";

/**
 * Cancel the older in-flight builds a new build supersedes (ADR 0045, decisions 2 and 3). Acts only
 * when the server option `supersedeOnCreate` is on, the instance runs testing and the project has
 * `cancelSuperseded` on; otherwise the list is ignored. `BuildModel.supersede` re-checks every id
 * (project, branch, commit, age, status, review activity), so a wrong list changes nothing. A
 * failure is logged and never fails the upload.
 */
export async function supersedeOlderBuilds(
  project: Pick<Project, "id" | "cancelSuperseded">,
  build: Build,
  ids: readonly string[] | undefined,
  announce: (buildId: string, status: "cancelled") => Promise<void>,
): Promise<void> {
  const { config, testing, logger } = getStore();
  if (!ids?.length || !testing || !config.supersedeOnCreate || project.cancelSuperseded === false) {
    return;
  }
  try {
    await new BuildModel(getStore().db).supersede(build, ids, {
      onCancelled: async (cancelled) => {
        await stopCancelled(cancelled, announce);
      },
    });
  } catch (err) {
    logger.warn({ err, buildId: build.id }, "superseding older builds failed");
  }
}

/** The existing cancel path: end the build's jobs and open attempts, then announce `cancelled`. */
async function stopCancelled(
  cancelled: Build,
  announce: (buildId: string, status: "cancelled") => Promise<void>,
): Promise<void> {
  const { db, cancelBuildJobs } = getStore();
  await cancelBuildJobs?.(cancelled.id);
  await new CaptureAttemptModel(db).closeOthers(cancelled.id, null, "Superseded by a newer build");
  await announce(cancelled.id, "cancelled");
}
