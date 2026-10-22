/** Publish a build's stored zip: extract with the caps, persist statics and manifest, clean the scratch. */
import type { DatabaseAdapter } from "../../adapters/database.ts";
import type { StorageAdapter } from "../../adapters/storage.ts";
import type { Logger } from "../../logger.ts";
import { removeShardScratch } from "../scratch.ts";
import { extractStorybookToScratch, persistStorybookStatics } from "../statics.ts";
import type { ExtractionLimits } from "./limits.ts";

/** Scratch id publishing uses, so it never shares a directory with the build's capture. */
export const PUBLISH_SCRATCH_ID = "publish";

/** What {@link publishStoredZip} works with. */
export interface PublishZipOptions {
  storage: StorageAdapter;
  scratchDir: string;
  limits: ExtractionLimits;
  /** Records the persisted content in `content_refs`, so retention knows who still uses it. */
  db?: DatabaseAdapter | undefined;
  logger: Logger;
  /** Called between stages (renews a job's lease). */
  touch?: () => void;
}

/**
 * Extract `storybook.zip` of a build and persist its statics. The manifest is written last, so a
 * build serves only once complete and a repeat run rewrites the same keys.
 *
 * @throws {ZipLimitError} When the zip breaks a cap or tries to escape the target.
 */
export async function publishStoredZip(
  options: PublishZipOptions,
  target: { projectId: string; buildId: string },
): Promise<void> {
  const { storage, scratchDir, logger } = options;
  const { projectId, buildId } = target;
  try {
    const dir = await extractStorybookToScratch(
      storage,
      scratchDir,
      projectId,
      buildId,
      PUBLISH_SCRATCH_ID,
      options.limits,
    );
    options.touch?.();
    await persistStorybookStatics(storage, dir, projectId, buildId, options.db);
    options.touch?.();
  } finally {
    await removeShardScratch(scratchDir, projectId, buildId, PUBLISH_SCRATCH_ID, logger);
  }
}
