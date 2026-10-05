/**
 * Hono HTTP middleware: `@hono/otel` server spans plus StoryShelf context.
 *
 * `@hono/otel` owns the `http.server` span (W3C extraction, route-template
 * naming, status attributes, request-duration metrics). This wrapper adds
 * `storyshelf.req_id` and `enduser.id` after downstream handlers run — still
 * inside the span, since `@hono/otel` finalizes after `next()` returns.
 */
import { httpInstrumentationMiddleware } from "@hono/otel";
import { context, trace } from "@opentelemetry/api";
import type { Context, MiddlewareHandler } from "hono";
import type { HttpMiddlewareOptions } from "./types.ts";

/** Copy request/user ids from the Hono context onto the active server span. */
function enrichSpan(c: Context): void {
  const span = trace.getSpan(context.active());
  if (!span) {
    return;
  }
  const reqId = c.get("requestId") as string | undefined;
  if (reqId) {
    span.setAttribute("storyshelf.req_id", reqId);
  }
  const userId = c.get("userId") as string | null | undefined;
  if (userId) {
    span.setAttribute("enduser.id", userId);
  }
}

/**
 * Create the instrumenting middleware.
 *
 * Mount directly after Hono's `requestId()` so `storyshelf.req_id` resolves;
 * `enduser.id` resolves when `storeScope` runs downstream.
 *
 * @param options - Service name/version for span resources.
 * @returns Hono middleware producing one `http.server` span per request.
 */
export function createHttpMiddleware(options: HttpMiddlewareOptions = {}): MiddlewareHandler {
  const otel = httpInstrumentationMiddleware({
    serviceName: options.serviceName ?? "storyshelf",
    serviceVersion: options.serviceVersion,
  });
  return async (c, next) => {
    return await otel(c, async () => {
      await next();
      enrichSpan(c);
    });
  };
}
