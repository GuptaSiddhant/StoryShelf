import type { Context, Next } from "hono";
import type { Logger } from "../logger.ts";

/** Hono middleware logging request start/end with duration. */
export function requestLogging(logger: Logger) {
  // oxlint-disable-next-line typescript/no-invalid-void-type -- Hono middleware may not return Response
  return async (c: Context, next: Next): Promise<Response | void> => {
    const started = performance.now();
    const id = c.get("requestId");
    logger.info({ reqId: id, method: c.req.method, url: c.req.path }, "request start");
    await next();
    logger.info(
      {
        reqId: id,
        method: c.req.method,
        url: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      },
      "request end",
    );
  };
}
