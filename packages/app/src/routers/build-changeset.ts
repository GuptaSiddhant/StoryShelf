import { createRoute, z } from "@hono/zod-openapi";
import { changesetOf } from "@storyshelf/core/models";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { VIEW_ROLES, buildForProject } from "./builds.handlers.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { notFound, unauthorized } from "./schemas.ts";

const component = z.object({
  importPath: z.string(),
  title: z.string(),
  storyCount: z.number(),
});

const changesetSchema = z
  .object({
    baseline: z
      .object({ id: z.string(), gitBranch: z.string(), gitSha: z.string() })
      .nullable()
      .describe("The build compared with; null for the first build"),
    added: component.array(),
    removed: component.array(),
    changed: component.extend({ previousStoryCount: z.number() }).array(),
    unchanged: z.number().describe("Components with the same hash in both builds"),
  })
  .openapi("BuildChangeset");

const getChangesetRoute = createRoute({
  method: "get",
  tags: ["Review"],
  summary: "Get a build's changeset",
  description:
    "Components the build added, removed or changed against its baseline build (the latest accepted build of its branch, else of the default branch), from the Storybook catalog. A changed hash means the component's stories changed, not that anything looks different. 404 when the project has review off.",
  path: "/api/v1/projects/{slug}/builds/{buildId}/changeset",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: changesetSchema } },
      description: "The build's changeset",
    },
    ...notFound,
    ...unauthorized,
  },
});

/** Register the changeset endpoint (`review` class). */
export function registerBuildChangeset(app: ShelfRouter): void {
  app.openapi(getChangesetRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    const build = await buildForProject(project.id, buildId);
    const { baseline, changeset } = await changesetOf(getStore().db, project, build);
    const { added, removed, changed, unchanged } = changeset;
    return c.json({
      baseline: baseline
        ? { id: baseline.id, gitBranch: baseline.gitBranch, gitSha: baseline.gitSha }
        : null,
      added,
      removed,
      changed,
      unchanged,
    });
  });
}
