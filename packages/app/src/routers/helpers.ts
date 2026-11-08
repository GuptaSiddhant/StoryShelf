import { MemberModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { TokenModel } from "@storyshelf/core/models";
import { UserModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { Token } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import { isUserFacingError, sha256, timingSafeEqualString } from "@storyshelf/core/utils";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getStore } from "../store.ts";
/** Send a JSON response with the given status code. */
export function json(c: Context, data: unknown, status: ContentfulStatusCode = 200): Response {
  return c.json(data, status);
}

/**
 * Whether the text of `error` was written for the person who sees it: a `UserFacingError`
 * (a deliberate refusal) or an `HTTPException` (its message is the answer). Anything else is a
 * driver, storage or library failure whose text is internal.
 */
function isClientSafe(error: unknown): error is Error {
  return isUserFacingError(error) || error instanceof HTTPException;
}

/**
 * The text a handler may answer with for a caught `error`: its own message when it is
 * {@link isClientSafe}, otherwise `fallback`, with the original logged (never sent). Use this
 * wherever a `catch` turns an error into response text; never read `error.message` for a response.
 */
export function publicMessage(error: unknown, fallback: string): string {
  if (isClientSafe(error)) {
    return error.message;
  }
  getStore().logger.error({ err: error }, "unexpected error answered with a generic message");
  return fallback;
}

/** Throw a 401 Unauthorized error for unauthenticated requests. */
export function unauthorized(): never {
  throw new HTTPException(401, { message: "Unauthorized" });
}

/** Throw a 403 Forbidden error for requests lacking the required role. */
export function forbidden(): never {
  throw new HTTPException(403, { message: "Forbidden" });
}

/** Throw a 404 Not Found error with a custom message. */
export function notFound(message = "Not found"): never {
  throw new HTTPException(404, { message });
}

/** Resolve the current session user's effective role on a project. */
export async function currentProjectRole(projectId: string): Promise<ProjectRole | null> {
  const { db, user } = getStore();
  if (!user) {
    return null;
  }
  return await new MemberModel(db).effectiveRole(user.role, projectId, user.id);
}

/** Look up a project by its URL slug, returning null when absent. */
export async function findProjectBySlug(slug: string): Promise<Project | null> {
  const { db } = getStore();
  return await new ProjectModel(db).getBySlug(slug);
}

async function resolveProjectByToken(
  c: Context,
  slug: string,
): Promise<{ project: Project; token: Token } | null> {
  const authHeader = c.req.header("authorization");
  // The bootstrap admin token is not a project token: let callers grant it as admin.
  if (authHeader?.startsWith("Bearer ") && !requestHasAdminToken(c)) {
    const token = authHeader.slice("Bearer ".length);
    const found = await new TokenModel(getStore().db).findByHash(sha256(token));
    if (!found) {
      unauthorized();
    }
    const project = await new ProjectModel(getStore().db).get(found.projectId);
    if (!project || project.slug !== slug) {
      forbidden();
    }
    return { project, token: found };
  }
  return null;
}

/**
 * Resolve a bearer token to an effective project role.
 * Tokens without an owner (legacy pre-binding rows) resolve as viewer;
 * tokens whose owner no longer exists resolve to null (deny).
 */
async function tokenProjectRole(token: Token, projectId: string): Promise<ProjectRole | null> {
  if (!token.userId) {
    return "viewer";
  }
  const { db } = getStore();
  const user = await new UserModel(db).get(token.userId);
  if (!user) {
    return null;
  }
  return await new MemberModel(db).effectiveRole(user.role, projectId, user.id);
}

/** Resolve a project by slug, honoring CLI bearer-token access. */
export async function resolveProject(c: Context, slug: string): Promise<Project> {
  const viaToken = await resolveProjectByToken(c, slug);
  if (viaToken) {
    return viaToken.project;
  }
  const found = await findProjectBySlug(slug);
  if (!found) {
    notFound("Project not found");
  }
  return found;
}

/**
 * True when the request bears the configured bootstrap admin token.
 * Covers site-admin routes AND project routes (as admin) so a fresh
 * instance is fully operable before any user exists. Timing-safe;
 * unset `adminToken` never matches.
 */
export function requestHasAdminToken(c: Context): boolean {
  const adminToken = getStore().config.adminToken;
  if (!adminToken) {
    return false;
  }
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  return timingSafeEqualString(header.slice("Bearer ".length), adminToken);
}

/**
 * Enforce the caller's project role for a given project.
 *
 * Authorization model (ADR 0008):
 * - No auth adapter configured -> all operations permitted (development mode).
 * - Bootstrap admin token -> grants access as admin (see `requestHasAdminToken`).
 * - Bearer token (CLI) -> grants access to its own project regardless of role.
 * - Session user -> must have an effective role in `minRoles`.
 */
export async function assertRole(projectId: string, ...minRoles: ProjectRole[]): Promise<void> {
  if (!getStore().authEnabled) {
    return;
  }
  const role = await currentProjectRole(projectId);
  if (!role || !minRoles.includes(role)) {
    forbidden();
  }
}

/** Resolve a project by slug and enforce the caller's minimum role. */
export async function resolveAuthorizedProject(
  c: Context,
  slug: string,
  ...minRoles: ProjectRole[]
): Promise<Project> {
  const viaToken = await resolveProjectByToken(c, slug);
  if (viaToken) {
    const role = await tokenProjectRole(viaToken.token, viaToken.project.id);
    if (!role || !minRoles.includes(role)) {
      forbidden();
    }
    return viaToken.project;
  }
  const found = await findProjectBySlug(slug);
  if (!found) {
    notFound("Project not found");
  }
  if (requestHasAdminToken(c)) {
    return found;
  }
  await assertRole(found.id, ...minRoles);
  return found;
}

/**
 * Who a verdict is attributed to (ADR 0013, decision 3): the session user, or the user who owns
 * the bearer token. `null` only when the instance has no auth adapter at all (one anonymous
 * reviewer). With auth on, a caller that cannot be traced to a user (the bootstrap admin token, a
 * token without an owner) is refused.
 */
export async function resolveReviewer(c: Context): Promise<string | null> {
  const { authEnabled, user, db } = getStore();
  if (!authEnabled) {
    return null;
  }
  if (user) {
    return user.id;
  }
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return unauthorized();
  }
  const token = requestHasAdminToken(c)
    ? null
    : await new TokenModel(db).findByHash(sha256(header.slice("Bearer ".length)));
  if (!token?.userId || !(await new UserModel(db).get(token.userId))) {
    throw new HTTPException(403, {
      message: "A verdict needs a user: use a token created by the reviewer or sign in",
    });
  }
  return token.userId;
}

/** Require a site-level admin (or permit when auth is disabled). */
export function requireSiteAdmin(c: Context): void {
  if (!getStore().authEnabled) {
    return;
  }
  const { user } = getStore();
  if (user?.role === "admin" || requestHasAdminToken(c)) {
    return;
  }
  forbidden();
}

/** Require the current session user to hold one of the given project roles. */
export async function requireProjectRole(
  projectId: string,
  ...minRoles: ProjectRole[]
): Promise<void> {
  await assertRole(projectId, ...minRoles);
}
