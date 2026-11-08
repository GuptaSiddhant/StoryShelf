/** Project label-type schemas. */
import { z } from "@hono/zod-openapi";

/** OpenAPI schema for a project label type. */
export const labelTypeSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    key: z.string(),
    name: z.string(),
    linkTemplate: z.string().nullable(),
    color: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("LabelType");

/** OpenAPI schema for creating a label type. */
export const labelTypeCreateSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    linkTemplate: z.string().optional(),
    color: z.string().optional(),
  })
  .openapi("LabelTypeCreateInput");

/** OpenAPI schema for patching a label type. */
export const labelTypeUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    linkTemplate: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
  })
  .openapi("LabelTypeUpdateInput");
