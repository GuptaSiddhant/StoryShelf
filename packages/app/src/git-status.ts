/** Mirror review outcomes to the git channels' commit status (the merge gate). */
import type { NotifierState } from "@storyshelf/core/adapter/notifier";
import { postStatusesForBuild } from "@storyshelf/core/capture";
import type { Build, Project } from "@storyshelf/core/schema";
import { credentialKeys } from "./credential-keys.ts";
import { getStore } from "./store.ts";

const CHECK_FOR: Record<string, NotifierState | undefined> = {
  approved: "success",
  rejected: "failure",
  reviewing: "pending",
};

/** Terminal outcomes decide the gate; `reviewing` only matters when it re-opens one. */
function isTerminal(status: string): boolean {
  return status === "approved" || status === "rejected";
}

/** The check state to post for a build moving `previous` → `next`, or null when nothing changes. */
export function checkForTransition(previous: string, next: string): NotifierState | null {
  if (previous === next) return null;
  if (isTerminal(next) || (next === "reviewing" && isTerminal(previous))) {
    return CHECK_FOR[next] ?? null;
  }
  return null;
}

/**
 * Post the `<prefix>/testing` status after a human review changes a build's
 * outcome. The capture consumer only posts `pending` and the capture-time result;
 * a `reviewing` build would otherwise stay pending on the PR after approval.
 * Provider errors never fail the review action.
 */
export async function postReviewStatus(
  project: Project,
  build: Pick<Build, "id" | "gitSha">,
  previous: string,
  next: string,
): Promise<void> {
  const status = checkForTransition(previous, next);
  if (!status) return;
  const { db, notifiers, config, logger } = getStore();
  await postStatusesForBuild({
    db,
    tables: { notificationChannels: db.tables.notificationChannels },
    project,
    sha: build.gitSha,
    status,
    url: `/projects/${project.slug}/builds/${build.id}`,
    notifiers,
    secret: credentialKeys(config),
    logger,
  }).catch((error: unknown) => {
    logger.warn({ err: error, buildId: build.id }, "failed to post review status");
  });
}
