/**
 * Whether a build's Storybook is published: the one probe behind the `<prefix>/storybook` status
 * (ADR 0014) and the rule that a verdict waits for publishing to end (ADR 0013, decision 3).
 */
import type { PublishingState } from "../../adapters/notifier/build-state.ts";
import type { StorageAdapter } from "../../adapters/storage.ts";
import type { Build } from "../../schema/build.ts";
import { storybookDir } from "../../utils/paths.ts";

/** What decides whether a missing manifest is a wait or a loss. */
export interface PublishingOptions {
  /**
   * Whether a capture runs for uploads (`testing`). Capture and publishing then run side by side
   * and either can end first, so a build can be reviewed before its manifest is written; only
   * without `testing`, where acceptance waits for publishing, does a finished build without a
   * manifest mean its content is gone.
   */
  testing?: boolean;
}

/**
 * How publishing the build stands. The manifest is written last, so its presence means done. A
 * `failed` or `cancelled` build without one did not publish (or never uploaded). Without `testing`
 * an `approved` or `rejected` build can only have got there through a published Storybook, so one
 * without a manifest is `unavailable` (purged or lost), not pending. Any other build waits.
 * Without a storage adapter nothing can be read: nothing counts as published, and a missing
 * manifest is never called a loss.
 */
export async function publishingOf(
  storage: StorageAdapter | undefined,
  build: Pick<Build, "id" | "projectId" | "status">,
  options: PublishingOptions = {},
): Promise<PublishingState> {
  if (
    storage !== undefined &&
    (await storage.exists(`${storybookDir(build.projectId, build.id)}/manifest.json`))
  ) {
    return "success";
  }
  if (build.status === "failed" || build.status === "cancelled") {
    return "failure";
  }
  // A missing manifest is only a loss when storage could be read.
  const finished = build.status === "approved" || build.status === "rejected";
  return finished && storage !== undefined && options.testing !== true ? "unavailable" : "pending";
}
