import type { DatabaseAdapter } from "../../adapters/database.ts";
/**
 * Whether a build's Storybook is published: the one probe behind the `<prefix>/storybook` status
 * (ADR 0014) and the rule that a verdict waits for publishing to end (ADR 0013, decision 3).
 */
import type { PublishingState } from "../../adapters/notifier/build-state.ts";
import type { StorageAdapter } from "../../adapters/storage.ts";
import { CaptureJobModel } from "../../models/capture-job.ts";
import type { Build } from "../../schema/build.ts";
import { storybookDir } from "../../utils/paths.ts";

/** What decides whether a missing manifest is a wait or a loss. */
export interface PublishingOptions {
  /**
   * Whether a `publish` job of the build is still open (queued, running or exhausting). With
   * `testing` on, capture runs beside publishing and can finish first, so a reviewed build whose
   * manifest is not there yet is only waiting while such a job exists.
   */
  publishJobOpen: boolean;
}

/** Statuses of a build that is past capture: its Storybook is no longer needed to render it. */
const PAST_CAPTURE: ReadonlySet<Build["status"]> = new Set(["reviewing", "approved", "rejected"]);

/**
 * How publishing the build stands. The manifest is written last, so its presence means done. A
 * `failed` or `cancelled` build without one did not publish (or never uploaded). A build past
 * capture (`reviewing`, `approved`, `rejected`) without one, and without an open `publish` job,
 * has lost its content (purged, or a legacy row): `unavailable`, not pending. Any other build
 * waits. Without a storage adapter nothing can be read: nothing counts as published, and a missing
 * manifest is never called a loss.
 */
export async function publishingOf(
  storage: StorageAdapter | undefined,
  build: Pick<Build, "id" | "projectId" | "status">,
  options: PublishingOptions,
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
  const lost = storage !== undefined && PAST_CAPTURE.has(build.status) && !options.publishJobOpen;
  return lost ? "unavailable" : "pending";
}

/**
 * {@link publishingOf} for a build whose open jobs are read from the database: the job check only
 * runs for a build past capture with no manifest, the one case that needs it.
 */
export async function publishingOfBuild(
  deps: { db: DatabaseAdapter; storage: StorageAdapter | undefined },
  build: Pick<Build, "id" | "projectId" | "status">,
): Promise<PublishingState> {
  const settled = await publishingOf(deps.storage, build, { publishJobOpen: true });
  if (settled !== "pending" || !PAST_CAPTURE.has(build.status)) {
    return settled;
  }
  const publishJobOpen = await new CaptureJobModel(deps.db).hasOpenJob(build.id, "publish");
  return await publishingOf(deps.storage, build, { publishJobOpen });
}
