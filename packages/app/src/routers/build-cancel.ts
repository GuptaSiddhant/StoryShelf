import { createRoute, z } from "@hono/zod-openapi";
import { BuildModel, CaptureAttemptModel } from "@storyshelf/core/models";
import type { Build } from "@storyshelf/core/schema";
import { CANCELLABLE_BUILD_STATUSES } from "@storyshelf/core/types";
import { HTTPException } from "hono/http-exception";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { DEVELOPER_ROLES, announceBuildStatus, buildForProject } from "./builds.handlers.ts";
import { flashHx } from "./flash.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { hxRefresh } from "./htmx.ts";
import { buildSchema, errorSchema, notFound, unauthorized } from "./schemas.ts";

const cancelBuildRoute = createRoute({
  method: "post",
  tags: ["Builds"],
  summary: "Cancel a build",
  description:
    "Stops the work of a build that has not finished capturing: its queued jobs (capture, publish and notification jobs alike) end cancelled, running ones are signalled and stop within seconds, and the build ends `cancelled`, a terminal status that a capture finishing late cannot move (retry resets it like a failed build). It raises `build:cancelled` (webhook and notification topic), never `build:failed` or a capture-failed alert. `testing` class. 409 when the build is not pending, capturing or comparing.",
  path: "/api/v1/projects/{slug}/builds/{buildId}/cancel",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: buildSchema } },
      description: "The build's jobs were cancelled and the build marked cancelled",
    },
    409: {
      content: { "application/json": { schema: errorSchema } },
      description: "The build is not in a cancellable state",
    },
    ...notFound,
    ...unauthorized,
  },
});

/** Register `POST …/builds/:buildId/cancel` (`testing` class). */
export function registerBuildCancel(app: ShelfRouter): void {
  app.openapi(cancelBuildRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    const build = await buildForProject(project.id, buildId);
    if (!CANCELLABLE_BUILD_STATUSES.includes(build.status)) {
      throw new HTTPException(409, { message: `A ${build.status} build cannot be cancelled` });
    }
    const updated = await cancelBuild(build.id);
    hxRefresh(c);
    flashHx(c, "Build cancelled");
    return c.json(updated, 200);
  });
}

/**
 * Cancel the build's jobs of every kind, close its open attempts, then end the build `cancelled` and
 * announce it. A capture still running notices the cancel on its next check (within seconds) and
 * stops; whatever it still writes cannot move the build off `cancelled`. The jobs end first so the
 * cancel's own notification job is not cancelled.
 */
async function cancelBuild(buildId: string): Promise<Build> {
  const { db, cancelBuildJobs } = getStore();
  await cancelBuildJobs?.(buildId);
  await new CaptureAttemptModel(db).closeOthers(buildId, null, "Cancelled by a user");
  const updated = await new BuildModel(db).setStatus(buildId, "cancelled");
  await announceBuildStatus(buildId, "cancelled");
  return updated;
}
