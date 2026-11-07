/** Shared response shapes: the acknowledgement, the error body and the standard error responses. */
import { z } from "@hono/zod-openapi";

/** OpenAPI schema for a generic `{ ok: true }` acknowledgement. */
export const okSchema = z.object({ ok: z.boolean() }).openapi("Ok");

/** OpenAPI schema for an error response message. */
export const errorSchema = z.object({ error: z.object({ message: z.string() }) }).openapi("Error");

/** Shared response spec for a 400 Bad Request. */
export const badRequest = {
  400: { content: { "application/json": { schema: errorSchema } }, description: "Bad request" },
} as const;

/** Shared response spec for a 401 Unauthorized. */
export const unauthorized = {
  401: { content: { "application/json": { schema: errorSchema } }, description: "Unauthorized" },
} as const;

/** Shared response spec for a 403 Forbidden. */
export const forbidden = {
  403: { content: { "application/json": { schema: errorSchema } }, description: "Forbidden" },
} as const;

/** Shared response spec for a 404 Not Found. */
export const notFound = {
  404: { content: { "application/json": { schema: errorSchema } }, description: "Not found" },
} as const;
