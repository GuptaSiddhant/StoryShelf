import { createRoute, z } from "@hono/zod-openapi";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { assertReviewEnabled, giveVerdict, reviewStateOf } from "./build-reviews.handlers.ts";
import { APPROVER_ROLES, VIEW_ROLES, buildForProject } from "./builds.handlers.ts";
import { resolveAuthorizedProject } from "./helpers.ts";
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
    "Give the build a verdict (approver and admin). A reviewer rewrites their verdict by posting again; the newest counts. With `testing` off the verdicts decide the build: `approved` once the project's required approvals are present and no reviewer's latest verdict is `rejected`, `rejected` when any is. With `testing` on the verdict is a sign-off and the snapshot rollup keeps deciding. 404 when the project has review off; 409 for a failed build.",
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
  },
});

/** Register the build-level verdict endpoints (`review` class). */
export function registerBuildReviews(app: ShelfRouter): void {
  app.openapi(getReviewsRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
    assertReviewEnabled(project);
    const build = await buildForProject(project.id, buildId);
    return c.json(await reviewStateOf(project, build));
  });

  app.openapi(createReviewRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const project = await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
    assertReviewEnabled(project);
    const build = await buildForProject(project.id, buildId);
    const userId = getStore().user?.id ?? null;
    return c.json(await giveVerdict(project, build, userId, c.req.valid("json")), 201);
  });
}
