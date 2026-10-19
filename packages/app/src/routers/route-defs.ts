import { createRoute, z } from "@hono/zod-openapi";
import { notFound, unauthorized } from "./schemas.ts";

/**
 * Route-definition builders for the `/projects/{slug}/…` JSON API. Each one
 * emits the same OpenAPI shape as a hand-written `createRoute` (slug param,
 * 404 and — for reads — 401 responses), keeping per-route boilerplate to the
 * parts that differ: tag, summary, path, schemas and descriptions.
 */

/** Default for routes whose path has only `{slug}`. */
// oxlint-disable-next-line typescript/no-generated-empty-object-type -- intentionally empty: no extra params
type NoParams = Record<never, never>;

interface RouteBase<Params extends z.ZodRawShape> {
  tag: string;
  summary: string;
  /** OpenAPI path template, e.g. `/api/v1/projects/{slug}/tokens/{tokenId}`. */
  path: string;
  /** Path params beyond `slug`. */
  params?: Params;
}

// oxlint-disable-next-line typescript/explicit-function-return-type -- inferred schema generics
const jsonBody = <Schema extends z.ZodType>(schema: Schema) => ({
  content: { "application/json": { schema } },
});

// oxlint-disable-next-line typescript/explicit-function-return-type -- inferred schema generics
const jsonResponse = <Schema extends z.ZodType>(schema: Schema, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

// oxlint-disable-next-line typescript/explicit-function-return-type -- inferred param shape
const slugParams = <Params extends z.ZodRawShape>(extra?: Params) =>
  z.object({ slug: z.string(), ...extra } as { slug: z.ZodString } & Params);

/** `GET` returning an array of `schema`. */
// oxlint-disable-next-line typescript/explicit-function-return-type, typescript/explicit-module-boundary-types -- the createRoute result type drives handler inference
export function listRouteDef<Schema extends z.ZodType, Params extends z.ZodRawShape = NoParams>(
  def: RouteBase<Params> & { schema: Schema; description: string },
) {
  return createRoute({
    method: "get",
    tags: [def.tag],
    summary: def.summary,
    path: def.path,
    request: { params: slugParams(def.params) },
    responses: {
      200: jsonResponse(def.schema.array(), def.description),
      ...notFound,
      ...unauthorized,
    },
  });
}

/** `POST` with a JSON body, answering 201 with `schema`. */
// oxlint-disable-next-line typescript/explicit-function-return-type, typescript/explicit-module-boundary-types -- the createRoute result type drives handler inference
export function postRouteDef<
  Body extends z.ZodType,
  Schema extends z.ZodType,
  Params extends z.ZodRawShape = NoParams,
>(def: RouteBase<Params> & { body: Body; schema: Schema; description: string }) {
  return createRoute({
    method: "post",
    tags: [def.tag],
    summary: def.summary,
    path: def.path,
    request: { params: slugParams(def.params), body: jsonBody(def.body) },
    responses: { 201: jsonResponse(def.schema, def.description), ...notFound },
  });
}

/** `PATCH` with a JSON body, answering 200 with `schema`. */
// oxlint-disable-next-line typescript/explicit-function-return-type, typescript/explicit-module-boundary-types -- the createRoute result type drives handler inference
export function patchRouteDef<
  Body extends z.ZodType,
  Schema extends z.ZodType,
  Params extends z.ZodRawShape = NoParams,
>(def: RouteBase<Params> & { body: Body; schema: Schema; description: string }) {
  return createRoute({
    method: "patch",
    tags: [def.tag],
    summary: def.summary,
    path: def.path,
    request: { params: slugParams(def.params), body: jsonBody(def.body) },
    responses: { 200: jsonResponse(def.schema, def.description), ...notFound },
  });
}

/** `POST` without a body, answering 200 with `schema` (e.g. resolve). */
// oxlint-disable-next-line typescript/explicit-function-return-type, typescript/explicit-module-boundary-types -- the createRoute result type drives handler inference
export function actionRouteDef<Schema extends z.ZodType, Params extends z.ZodRawShape = NoParams>(
  def: RouteBase<Params> & { schema: Schema; description: string },
) {
  return createRoute({
    method: "post",
    tags: [def.tag],
    summary: def.summary,
    path: def.path,
    request: { params: slugParams(def.params) },
    responses: { 200: jsonResponse(def.schema, def.description), ...notFound },
  });
}

/** `DELETE` answering 204. */
// oxlint-disable-next-line typescript/explicit-function-return-type, typescript/explicit-module-boundary-types -- the createRoute result type drives handler inference
export function deleteRouteDef<Params extends z.ZodRawShape = NoParams>(
  def: RouteBase<Params> & { description: string },
) {
  return createRoute({
    method: "delete",
    tags: [def.tag],
    summary: def.summary,
    path: def.path,
    request: { params: slugParams(def.params) },
    responses: { 204: { description: def.description }, ...notFound },
  });
}
