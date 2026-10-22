/**
 * Whether a build's Storybook is published: the one probe behind the `<prefix>/storybook` status
 * (ADR 0014) and the rule that a verdict waits for publishing to end (ADR 0013, decision 3).
 */
import type { PublishingState } from "../../adapters/notifier/build-state.ts";
import type { StorageAdapter } from "../../adapters/storage.ts";
import type { Build } from "../../schema/build.ts";
import { storybookDir } from "../../utils/paths.ts";

/**
 * How publishing the build stands. The manifest is written last, so its presence means done. A
 * `failed` build without one failed to publish (or never uploaded); any other build waits. Without
 * a storage adapter nothing can be read, so publishing reads as pending.
 */
export async function publishingOf(
  storage: StorageAdapter | undefined,
  build: Pick<Build, "id" | "projectId" | "status">,
): Promise<PublishingState> {
  const published =
    storage !== undefined &&
    (await storage.exists(`${storybookDir(build.projectId, build.id)}/manifest.json`));
  if (published) {
    return "success";
  }
  return build.status === "failed" ? "failure" : "pending";
}
