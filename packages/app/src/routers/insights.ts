import { createRoute, z } from "@hono/zod-openapi";
import { InsightModel } from "@storyshelf/core/models";
import type { ShelfRouter } from "../app-types.ts";
import { failWith } from "../insights/errors.ts";
import { requestHealth, requestTriage } from "../insights/request.ts";
import { toInsightView } from "../insights/view.ts";
import { buildForProject } from "./builds.handlers.ts";
import { notFound as throwNotFound } from "./helpers.ts";
import { isSiteAdmin, projectForRegenerate, projectForView } from "./insights.handlers.ts";
import {
  badRequest,
  errorSchema,
  healthRequestSchema,
  insightRequestSchema,
  insightSchema,
  notFound,
  unauthorized,
} from "./schemas.ts";

const BUILD_PARAMS = z.object({ slug: z.string(), buildId: z.string() });
const json = (schema: z.ZodType): { content: { "application/json": { schema: z.ZodType } } } => ({
  content: { "application/json": { schema } },
});
const guardResponses = {
  501: { ...json(errorSchema), description: "AI is not configured on this server (ai-disabled)" },
  409: { ...json(errorSchema), description: "AI is disabled for this project" },
  ...notFound,
  ...unauthorized,
} as const;

const latestRoute = createRoute({
  method: "get",
  tags: ["Insights"],
  summary: "Latest build triage",
  path: "/api/v1/projects/{slug}/builds/{buildId}/insights/latest",
  request: { params: BUILD_PARAMS },
  responses: { 200: { ...json(insightSchema), description: "Latest triage" }, ...guardResponses },
});

const listRoute = createRoute({
  method: "get",
  tags: ["Insights"],
  summary: "Build triage history",
  path: "/api/v1/projects/{slug}/builds/{buildId}/insights",
  request: {
    params: BUILD_PARAMS,
    query: z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }),
  },
  responses: {
    200: { ...json(insightSchema.array()), description: "Triage history" },
    ...guardResponses,
  },
});

const generateRoute = createRoute({
  method: "post",
  tags: ["Insights"],
  summary: "Generate a build triage",
  path: "/api/v1/projects/{slug}/builds/{buildId}/insights",
  request: {
    params: BUILD_PARAMS,
    body: { content: { "application/json": { schema: insightRequestSchema } } },
  },
  responses: {
    200: { ...json(insightSchema), description: "Cached insight (unbilled)" },
    202: { ...json(insightSchema), description: "Generation started; poll the latest endpoint" },
    429: { ...json(errorSchema), description: "Budget or rate limit reached (see Retry-After)" },
    ...guardResponses,
  },
});

const healthGetRoute = createRoute({
  method: "get",
  tags: ["Insights"],
  summary: "Project health digest",
  path: "/api/v1/projects/{slug}/insights/health",
  request: {
    params: z.object({ slug: z.string() }),
    query: z.object({ window: z.string().optional() }),
  },
  responses: { 200: { ...json(insightSchema), description: "Cached digest" }, ...guardResponses },
});

const healthPostRoute = createRoute({
  method: "post",
  tags: ["Insights"],
  summary: "Generate a project health digest",
  path: "/api/v1/projects/{slug}/insights/health",
  request: {
    params: z.object({ slug: z.string() }),
    body: { content: { "application/json": { schema: healthRequestSchema } } },
  },
  responses: {
    200: { ...json(insightSchema), description: "Cached digest (unbilled)" },
    202: { ...json(insightSchema), description: "Generation started" },
    429: { ...json(errorSchema), description: "Budget or rate limit reached (see Retry-After)" },
    ...badRequest,
    ...guardResponses,
  },
});

/** Register the build triage endpoints. */
function registerBuildInsights(app: ShelfRouter): void {
  app.openapi(latestRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const { deps, project } = await projectForView(c, slug);
    const build = await buildForProject(project.id, buildId);
    const [latest] = await new InsightModel(deps.db).listForBuild(build.id, 1);
    return latest
      ? c.json(toInsightView(latest), 200)
      : throwNotFound("never-generated: POST to this build's insights to create one");
  });

  app.openapi(listRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const { limit } = c.req.valid("query");
    const { deps, project } = await projectForView(c, slug);
    const build = await buildForProject(project.id, buildId);
    const rows = await new InsightModel(deps.db).listForBuild(build.id, limit ?? 20);
    return c.json(
      rows.map((row) => toInsightView(row)),
      200,
    );
  });

  app.openapi(generateRoute, async (c) => {
    const { slug, buildId } = c.req.valid("param");
    const body = c.req.valid("json");
    const { deps, project } = await projectForRegenerate(c, slug);
    const build = await buildForProject(project.id, buildId);
    const outcome = await requestTriage(deps, project, build, {
      force: body.force ?? false,
      profile: isSiteAdmin(c) ? body.profile : undefined,
    });
    const view = toInsightView(outcome.row);
    return outcome.status === 200
      ? c.json(view, 200)
      : c.json(view, 202, {
          location: `/api/v1/projects/${slug}/builds/${build.id}/insights/latest`,
        });
  });
}

/** Register the project-health endpoints. */
function registerHealthInsights(app: ShelfRouter): void {
  app.openapi(healthGetRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const { window } = c.req.valid("query");
    const { deps, project } = await projectForView(c, slug);
    const row = await new InsightModel(deps.db).getHealth(project.id, window ?? "30d");
    return row
      ? c.json(toInsightView(row), 200)
      : throwNotFound("never-generated: POST to create a health digest");
  });

  app.openapi(healthPostRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const body = c.req.valid("json");
    const { deps, project } = await projectForRegenerate(c, slug);
    const window = body.window ?? "30d";
    const outcome = await requestHealth(deps, project, window, { force: body.force ?? false });
    if (!outcome) {
      failWith(400, "window must look like 30d (1-365 days)");
    }
    const view = toInsightView(outcome.row);
    return outcome.status === 200
      ? c.json(view, 200)
      : c.json(view, 202, {
          location: `/api/v1/projects/${slug}/insights/health?window=${window}`,
        });
  });
}

/** Register the AI insights endpoints (build triage and project health). */
export function registerInsights(app: ShelfRouter): void {
  registerBuildInsights(app);
  registerHealthInsights(app);
}
