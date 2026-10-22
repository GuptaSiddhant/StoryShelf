import { createRoute, z } from "@hono/zod-openapi";
import type { ShelfRouter } from "../app-types.ts";
import { giveVerdict, reviewStateOf } from "./build-reviews.handlers.ts";
import { APPROVER_ROLES, VIEW_ROLES, buildForProject } from "./builds.handlers.ts";
import { flashHx } from "./flash.ts";
import { resolveAuthorizedProject, resolveReviewer } from "./helpers.ts";
import { hxRefresh } from "./htmx.ts";
import {
  buildReviewCreateSchema,
  buildReviewSchema,
  buildReviewStateSchema,
  forbidden as forbiddenResponse,
  notFound,
  unauthorized,
} from "./schemas.ts";

const params = z.object({ slug: z.string(), buildId: z.string() });

const getReviewsRoute = createRoute({
  method: "get",
  tags: ["Review"],
  summary: "Get a build's review state",
  description:
    "The verdicts reviewers gave the build and what they make of it: each reviewer's latest verdict, the approvals against the project's requirement, and the full history. 404 when the project has review off.",
  path: "/api/v1/projects/{slug}/builds/{buildId}/reviews",
  request: { params },
  responses: {
    200: {
      content: { "application/json": { schema: buildReviewStateSchema } },
      description: "Review state of the build",
    },
    ...notFound,
    ...unauthorized,
  },
});

const createReviewRoute = createRoute({
  method: "post",
  tags: ["Review"],
  summary: "Approve or reject a build",
  description:
    "Give the build a verdict (approver and admin). A reviewer rewrites their verdict by posting again; the newest counts. With `testing` off the verdicts decide the build: `approved` once the project's required approvals are present and no reviewer's latest verdict is `rejected`, `rejected` when any is. With `testing` on the verdict is a sign-off and the snapshot rollup keeps deciding. The verdict is attributed to the signed-in user, or to the user who owns the API token; a caller that is no user (the bootstrap admin token) gets 403, and only an instance with no authentication at all records an anonymous verdict, which counts when the project needs one approval (409 otherwise). 404 when the project has review off; 409 for a failed build, while the build is still publishing, or for an anonymous verdict the project cannot count.",
  path: "/api/v1/projects/{slug}/builds/{buildId}/reviews",
  request: {
    params,
    body: { content: { "application/json": { schema: buildReviewCreateSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: buildReviewSchema } },
      description: "Verdict recorded",
    },
    ...forbiddenResponse,
    ...notFound,
    ...unauthorized,
  },
});

/** Register the build-level verdict endpoints (`review` class). */
export function registerBuildReviews(app: ShelfRouter): void {
  app.openapi(getReviewsRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    const build = await buildForProject(project.id, buildId);
    return c.json(await reviewStateOf(project, build));
  });

  app.openapi(createReviewRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    const build = await buildForProject(project.id, buildId);
    const userId = await resolveReviewer(c);
    const review = await giveVerdict(project, build, userId, c.req.valid("json"));
    hxRefresh(c);
    flashHx(c, "Verdict recorded");
    return c.json(review, 201);
  });
}
