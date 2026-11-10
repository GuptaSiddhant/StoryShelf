/** Insight and project-health schemas. */
import { z } from "@hono/zod-openapi";

/** OpenAPI schema for an insight (build triage or project health). */
export const insightSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["triage", "health"]),
    buildId: z.string().nullable(),
    window: z.string().nullable(),
    status: z.enum(["pending", "running", "done", "failed"]),
    profile: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    verdict: z.string().nullable(),
    summary: z.string().nullable(),
    output: z.unknown().nullable(),
    meta: z.unknown().nullable(),
    errorCode: z.string().nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
  })
  .openapi("Insight");

/** Request body to (re)generate a build triage. */
export const insightRequestSchema = z
  .object({
    task: z.literal("triage").optional(),
    force: z.boolean().optional(),
    profile: z.string().min(1).optional(),
  })
  .openapi("InsightRequest");

/** Request body to (re)generate a project-health digest. */
export const healthRequestSchema = z
  .object({ window: z.string().optional(), force: z.boolean().optional() })
  .openapi("HealthInsightRequest");
