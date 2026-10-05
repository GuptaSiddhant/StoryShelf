import { createRoute, z } from "@hono/zod-openapi";
import { CaptureAttemptModel } from "@storyshelf/core/models";
import { CaptureLogModel } from "@storyshelf/core/models";
import type { Build, CaptureAttempt } from "@storyshelf/core/schema";
import type { Context } from "hono";
import type { ShelfRouter } from "../app-types.ts";
import { getStore } from "../store.ts";
import { VIEW_ROLES, buildForProject } from "./builds.handlers.ts";
import { notFound, resolveAuthorizedProject } from "./helpers.ts";
import { notFound as notFoundResponse, unauthorized } from "./schemas.ts";
import { attemptLogSchema, attemptSchema } from "./schemas.ts";

/** Register the capture-attempt history and per-attempt log endpoints. */
export function registerAttempts(app: ShelfRouter): void {
  app.openapi(listAttemptsRoute, async (c) => {
    const build = await scopedBuild(c, c.req.valid("param"));
    const attempts = await new CaptureAttemptModel(getStore().db).listByBuild(build.id);
    return c.json(attempts);
  });

  app.openapi(getAttemptRoute, async (c) => {
    const build = await scopedBuild(c, c.req.valid("param"));
    return c.json(await attemptForBuild(build, c.req.valid("param").attemptNo));
  });

  app.openapi(listAttemptLogsRoute, async (c) => {
    const build = await scopedBuild(c, c.req.valid("param"));
    const attempt = await attemptForBuild(build, c.req.valid("param").attemptNo);
    const logs = await new CaptureLogModel(getStore().db).listByAttempt(attempt.id);
    return c.json(logs);
  });
}

const buildParams = z.object({ slug: z.string(), buildId: z.string() });

const attemptParams = z.object({
  slug: z.string(),
  buildId: z.string(),
  attemptNo: z.coerce.number().int().min(1),
});

const listAttemptsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/builds/{buildId}/attempts",
  request: { params: buildParams },
  responses: {
    200: {
      content: { "application/json": { schema: attemptSchema.array() } },
      description: "List capture attempts for a build (oldest first)",
    },
    ...notFoundResponse,
    ...unauthorized,
  },
});

const getAttemptRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/builds/{buildId}/attempts/{attemptNo}",
  request: { params: attemptParams },
  responses: {
    200: {
      content: { "application/json": { schema: attemptSchema } },
      description: "Fetch a single capture attempt",
    },
    ...notFoundResponse,
    ...unauthorized,
  },
});

const listAttemptLogsRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{slug}/builds/{buildId}/attempts/{attemptNo}/logs",
  request: { params: attemptParams },
  responses: {
    200: {
      content: { "application/json": { schema: attemptLogSchema.array() } },
      description: "List every log line of a capture attempt (in order)",
    },
    ...notFoundResponse,
    ...unauthorized,
  },
});

/** Resolve the project (viewer+) and the build scoped to it. */
async function scopedBuild(c: Context, params: { slug: string; buildId: string }): Promise<Build> {
  const project = await resolveAuthorizedProject(c, params.slug, ...VIEW_ROLES);
  return await buildForProject(project.id, params.buildId);
}

/** Fetch an attempt scoped to its build, throwing 404 when it does not belong. */
async function attemptForBuild(build: Build, attemptNo: number): Promise<CaptureAttempt> {
  const attempt = await new CaptureAttemptModel(getStore().db).getByNo(build.id, attemptNo);
  if (!attempt) {
    notFound("Attempt not found");
  }
  return attempt;
}
