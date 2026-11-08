import type { Logger } from "@storyshelf/core/logger";
import type { Context, Env, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isHxRequest } from "../routers/htmx.ts";

/** The part of the URL space that answers errors as JSON; pages and forms keep their own answers. */
const API_PREFIX = "/api/v1";

/** Whether `path` is the JSON API (`/api/v1` and below, not a sibling like `/api/v10`). */
export function isApiPath(path: string): boolean {
  return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
}

/**
 * Whether this request is answered with the envelope: a call to the API, not one the app's own
 * pages make with HTMX, which swaps the answer into the page and keeps getting its old one.
 */
function wantsEnvelope(c: Context): boolean {
  return isApiPath(c.req.path) && !isHxRequest(c);
}

/** The body of every `/api/v1` error: `{ error: { message } }`, plus any fields a route adds to `error`. */
export interface ApiErrorBody {
  error: { message: string } & Record<string, unknown>;
}

/** The shared error envelope as a value, for typed route handlers: `c.json(errorBody(message), 409)`. */
export function errorBody(message: string): { error: { message: string } } {
  return { error: { message } };
}

/** Answer `status` with the shared error envelope; `extra` fields sit next to `error.message`. */
export function apiErrorResponse(
  c: Context,
  status: ContentfulStatusCode,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  const body: ApiErrorBody = { error: { message, ...extra } };
  return c.json(body, status);
}

/**
 * A guard's JSON refusal: the envelope under `/api/v1`, and the `{ error: message }` shape it always
 * had elsewhere (the auth engine and form posts), so only the documented API changes.
 */
export function jsonRefusal(
  c: Context,
  status: ContentfulStatusCode,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return wantsEnvelope(c)
    ? apiErrorResponse(c, status, message, extra)
    : c.json({ error: message, ...extra }, status);
}

/** Whether an exception carries its own JSON answer (a route that adds fields to `error`). */
function hasJsonResponse(error: HTTPException): boolean {
  const type = error.res?.headers.get("content-type") ?? "";
  return type.includes("application/json");
}

/** The answer to a thrown `HTTPException`: the envelope on the API, Hono's own answer elsewhere. */
function answerRefusal(error: HTTPException, c: Context): Response {
  if (!wantsEnvelope(c) || hasJsonResponse(error)) {
    return error.getResponse();
  }
  return apiErrorResponse(c, error.status, error.message);
}

/** The answer to anything else thrown: logged with its cause, and only a generic message sent. */
function answerUnexpected(error: Error, c: Context, logger: Logger): Response {
  logger.error({ err: error, url: c.req.path }, "unhandled error answered with a generic message");
  return wantsEnvelope(c)
    ? apiErrorResponse(c, 500, "Internal Server Error")
    : c.text("Internal Server Error", 500);
}

/**
 * Mount the app's one error handler and its not-found answer.
 *
 * Under `/api/v1` a refusal (`HTTPException`), an unexpected error and an unknown path all answer
 * `{ error: { message } }` with their own status, matching the OpenAPI document. An exception that
 * brings its own JSON body keeps it, so a route can add fields next to `error.message`. Anywhere
 * else, and for the HTMX requests the app's own pages make to these routes, the answers are Hono's
 * defaults: text for a missing path, the exception's own response.
 */
export function mountErrorHandlers<E extends Env>(app: Hono<E>, logger: Logger): void {
  app.onError((error, c) =>
    error instanceof HTTPException ? answerRefusal(error, c) : answerUnexpected(error, c, logger),
  );
  app.notFound((c) =>
    wantsEnvelope(c) ? apiErrorResponse(c, 404, "Not found") : c.text("404 Not Found", 404),
  );
}

/** The message of a request that failed validation: each bad field and why, in one line. */
export function validationMessage(
  issues: readonly { path: PropertyKey[]; message: string }[],
): string {
  const parts = issues.map((issue) => {
    const field = issue.path.map(String).join(".");
    return field ? `${field}: ${issue.message}` : issue.message;
  });
  return parts.length > 0 ? parts.join("; ") : "Invalid request";
}

/** The hook that answers a request failing an OpenAPI route's validation with a 400 and the envelope. */
export function rejectInvalidRequest(
  result:
    | { success: true }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } },
  c: Context,
): Response | undefined {
  return result.success
    ? undefined
    : apiErrorResponse(c, 400, validationMessage(result.error.issues));
}
