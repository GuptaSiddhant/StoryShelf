/** Retention purge schemas. */
import { z } from "@hono/zod-openapi";

/** OpenAPI schema for the retention purge result. */
export const purgeSchema = z
  .object({
    removedBuilds: z.number(),
    removedBranches: z.number().optional(),
    removedBaselines: z.number().optional(),
    protected: z.number().optional(),
    resumed: z.number().optional(),
  })
  .openapi("PurgeResult");

/** OpenAPI schema for the retention purge input. */
export const purgeInputSchema = z.object({ ttlDays: z.number().optional() }).openapi("PurgeInput");
