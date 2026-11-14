import { createRoute, z } from "@hono/zod-openapi";
import { BuildModel } from "@storyshelf/core/models";
import { CANCELLABLE_BUILD_STATUSES } from "@storyshelf/core/types";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { DEVELOPER_ROLES } from "./builds.handlers.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { notFound, unauthorized } from "./schemas.ts";

const inFlightSchema = z
  .object({ id: z.string(), sha: z.string() })
  .array()
  .openapi("InFlightBuilds");

const inFlightRoute = createRoute({
  method: "get",
  tags: ["Builds"],
  summary: "List a branch's in-flight builds",
  description:
    "The builds of one branch that are still working (pending, capturing or comparing), as `{ id, sha }`. The CLI compares them with local history and names the older ones in `supersedes` when it creates a build (ADR 0045). Same roles as build creation. `testing` class.",
  path: "/api/v1/projects/{slug}/builds/in-flight",
  request: {
    params: z.object({ slug: z.string() }),
    query: z.object({ branch: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: inFlightSchema } },
      description: "The branch's builds in a cancellable status, newest first",
    },
    ...notFound,
    ...unauthorized,
  },
});

/** Register `GET …/builds/in-flight` (`testing` class). Register before `…/builds/:buildId`. */
export function registerBuildsInFlight(app: ShelfRouter): void {
  app.openapi(inFlightRoute, async (c) => {
    const project = await resolveAuthorizedProject(
      c,
      c.req.valid("param").slug,
      ...DEVELOPER_ROLES,
    );
    const { branch } = c.req.valid("query");
    const builds = await new BuildModel(getStore().db).list(project.id, { branch });
    return c.json(
      builds
        .filter((build) => CANCELLABLE_BUILD_STATUSES.includes(build.status))
        .map((build) => ({ id: build.id, sha: build.gitSha })),
      200,
    );
  });
}
