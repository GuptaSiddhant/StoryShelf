/** The switch-off pass at the app level (ADR 0013, decision 1): accept the queue review leaves behind. */
import { acceptPendingWithoutWork } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import { requestBuildState } from "../git-status.ts";
import { getStore } from "../store.ts";

/**
 * When a save turned review off (`before` had it on), accept the project's pending builds that no
 * capture worked on, in one pass. It raises no approval event (nobody approved anything), but each
 * build's git channels are asked to show its new state. Returns the number of builds accepted.
 */
export async function runSwitchOffPass(before: Project, after: Project): Promise<number> {
  if (before.reviewEnabled === false || after.reviewEnabled !== false) {
    return 0;
  }
  const accepted = await acceptPendingWithoutWork(getStore().db, after.id);
  await Promise.all(
    accepted.map(async (build) => {
      await requestBuildState(build.id);
    }),
  );
  getStore().logger.info(
    { projectId: after.id, accepted: accepted.length },
    "review turned off: accepted pending builds",
  );
  return accepted.length;
}
