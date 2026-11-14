import { createRoute, z } from "@hono/zod-openapi";
import { BUILD_STATUSES, SNAPSHOT_STATUSES } from "@storyshelf/core/types";
import type { Context, Next } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { VIEW_ROLES, buildForProject } from "./builds.handlers.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
import { notFound, unauthorized } from "./schemas.ts";
import { storyStatusOf } from "./story-status.handlers.ts";

/** Hono pattern of the route, shared with the middleware that keeps every answer out of caches. */
export const STORY_STATUS_PATH = "/api/v1/projects/:slug/builds/:buildId/story-status";

const storyStatusSchema = z
  .object({
    build: z.object({
      status: z.enum(BUILD_STATUSES),
      reviewPath: z
        .string()
        .describe("Path and query of the build's review page, no scheme or host"),
    }),
    stories: z.record(
      z.string(),
      z.object({
        status: z.enum(SNAPSHOT_STATUSES).describe("Worst snapshot status across the story's rows"),
        design: z.enum(["stale", "deleted"]).optional(),
      }),
    ),
  })
  .openapi("StoryStatus");

const storyStatusRoute = createRoute({
  method: "get",
  tags: ["Review"],
  summary: "Per-story review state of a build",
  description:
    "Read-only state for the Storybook addon (ADR 0042): the worst snapshot status of each story and a design problem where one is known. Stories with no snapshot are omitted. Never carries images, signed URLs, comments or reviewer identities. Answers `Cache-Control: private, no-store`.",
  path: "/api/v1/projects/{slug}/builds/{buildId}/story-status",
  request: { params: z.object({ slug: z.string(), buildId: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: storyStatusSchema } },
      description: "The build's per-story state",
    },
    ...notFound,
    ...unauthorized,
  },
});

/**
 * `Cache-Control: private, no-store` on every answer of the route, the refusals included: the body
 * depends on who asks. Mounted ahead of `requireTesting`, so the 404 of a hosting-only instance has it too.
 */
export async function storyStatusNoStore(c: Context, next: Next): Promise<void> {
  await next();
  c.res.headers.set("Cache-Control", "private, no-store");
}

/** Register the story-status endpoint (`testing` class). */
export function registerStoryStatus(app: ShelfRouter): void {
  app.openapi(storyStatusRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    const build = await buildForProject(project.id, buildId);
    return c.json(await storyStatusOf(project, build), 200);
  });
}
