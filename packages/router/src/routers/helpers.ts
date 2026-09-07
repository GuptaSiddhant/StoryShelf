import { MemberModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import { TokenModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { ProjectRole } from "@storyshelf/core/types";
import { sha256 } from "@storyshelf/core/utils";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodType } from "zod";
import { getStore } from "../store.ts";

/** Send a JSON response with the given status code. */
export function json(c: Context, data: unknown, status: ContentfulStatusCode = 200): Response {
  return c.json(data, status);
}

/** Parse the request body as JSON and validate it against a Zod schema. */
export async function validJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  const result = schema.safeParse(await c.req.json());
  if (!result.success) {
    throw new HTTPException(400, { message: result.error.message });
  }
  return result.data;
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

/** Build middleware that requires one of the given project roles. */
export function requireRole(...roles: ProjectRole[]) {
  return async (c: Context, next: Next): Promise<void> => {
    const projectId = c.req.param("projectId") ?? c.req.param("slug");
    if (!projectId) {
      forbidden();
    }
    const role = await currentProjectRole(projectId);
    if (!role || !roles.includes(role)) {
      forbidden();
    }
    await next();
  };
}

/** Look up a project by its URL slug, returning null when absent. */
export async function findProjectBySlug(slug: string): Promise<Project | null> {
  const { db } = getStore();
  return await new ProjectModel(db).getBySlug(slug);
}

async function resolveProjectByToken(c: Context, slug: string): Promise<Project | null> {
  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    const found = await new TokenModel(getStore().db).findByHash(sha256(token));
    if (!found) {
      unauthorized();
    }
    const project = await new ProjectModel(getStore().db).get(found.projectId);
    if (!project || project.slug !== slug) {
      forbidden();
    }
    return project;
  }
  return null;
}

/** Resolve a project by slug, honoring CLI bearer-token access. */
export async function resolveProject(c: Context, slug: string): Promise<Project> {
  const project = await resolveProjectByToken(c, slug);
  if (project) {
    return project;
  }
  const found = await findProjectBySlug(slug);
  if (!found) {
    notFound("Project not found");
  }
  return found;
}

/**
 * Enforce the caller's project role for a given project.
 *
 * Authorization model (ADR 0008):
 * - No auth adapter configured -> all operations permitted (development mode).
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
  const project = await resolveProjectByToken(c, slug);
  if (project) {
    return project;
  }
  const found = await findProjectBySlug(slug);
  if (!found) {
    notFound("Project not found");
  }
  await assertRole(found.id, ...minRoles);
  return found;
}

/** Require a site-level admin (or permit when auth is disabled). */
export function requireSiteAdmin(): void {
  if (!getStore().authEnabled) {
    return;
  }
  const { user } = getStore();
  if (user?.role !== "admin") {
    forbidden();
  }
}

/** Require the current session user to hold one of the given project roles. */
export async function requireProjectRole(
  projectId: string,
  ...minRoles: ProjectRole[]
): Promise<void> {
  await assertRole(projectId, ...minRoles);
}
