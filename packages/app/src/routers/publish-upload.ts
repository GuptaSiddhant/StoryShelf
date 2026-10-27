/**
 * What the zip upload route does once the zip is stored (ADR 0006, decision 10): extract it
 * inline when it is small, hand it to a `publish` job when it is larger, or refuse it with a
 * pointer to the file-by-file route on a host that runs no consumer.
 */
import {
  extractionLimitsOf,
  FILE_BY_FILE_HINT,
  publishRoute,
  publishStoredZip,
  resolvePublishLimits,
  ZipInvalidError,
  ZipLimitError,
} from "@storyshelf/core/capture";
import { DEFAULT_SCRATCH_DIR } from "@storyshelf/core/config";
import { BuildModel } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import { storybookZipPath } from "@storyshelf/core/utils";
import { HTTPException } from "hono/http-exception";
import { getStore } from "../store.ts";

/** How an upload of `zipBytes` will be published, or a 413 when this host cannot publish it. */
export function planUpload(zipBytes: number): "inline" | "job" {
  const { config, publish } = getStore();
  const route = publishRoute(zipBytes, resolvePublishLimits(config));
  if (route === "job" && !publish?.enqueuePublish) {
    throw new HTTPException(413, { message: FILE_BY_FILE_HINT });
  }
  return route;
}

/** Remove a stored zip that was refused (best effort), so no orphan is left behind. */
export async function discardZip(projectId: string, buildId: string): Promise<void> {
  try {
    await getStore().storage.delete(storybookZipPath(projectId, buildId));
  } catch (error) {
    getStore().logger.warn({ err: error, buildId }, "could not remove a refused zip");
  }
}

/**
 * Publish the stored zip of `build` per `route`. Inline: extract now and complete the build (a
 * failure fails it, or, with a capture to come, is left for capture to backfill). Job: queue it.
 * Resolves to the build as it stands afterwards.
 */
export async function publishUpload(
  route: "inline" | "job",
  build: Build,
  reqId: string | undefined,
): Promise<Build> {
  const { publish } = getStore();
  if (route === "job") {
    await publish?.enqueuePublish?.(build.id, reqId);
    return build;
  }
  await publishInline(build);
  return (await new BuildModel(getStore().db).get(build.id)) ?? build;
}

async function publishInline(build: Build): Promise<void> {
  const { storage, config, logger, publish, db } = getStore();
  try {
    await publishStoredZip(
      {
        storage,
        scratchDir: config.scratchDir ?? DEFAULT_SCRATCH_DIR,
        limits: extractionLimitsOf(resolvePublishLimits(config)),
        db,
        logger,
      },
      { projectId: build.projectId, buildId: build.id },
    );
    logger.info({ buildId: build.id }, "upload statics persisted inline");
    await publish?.completer.complete(build.id, { ok: true });
  } catch (error) {
    if (error instanceof ZipInvalidError || error instanceof ZipLimitError) {
      await discardZip(build.projectId, build.id);
      throw new HTTPException(422, { message: error.message });
    }
    await failInlinePublish(build, error);
  }
}

async function failInlinePublish(build: Build, error: unknown): Promise<void> {
  const { logger, publish } = getStore();
  const message = error instanceof Error ? error.message : String(error);
  logger.error({ err: error, buildId: build.id }, "inline publish failed");
  await publish?.completer.complete(build.id, { ok: false, error: message });
}
