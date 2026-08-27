import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodType } from "zod";

import { MemberModel } from "../models/member.ts";
import { ProjectModel } from "../models/project.ts";
import { TokenModel } from "../models/token.ts";
import { projects, type Project } from "../schema.ts";
import { getStore } from "../store.ts";
import type { ProjectRole } from "../types.ts";
import { sha256 } from "../utils/hash.ts";

export function json(c: Context, data: unknown, status: ContentfulStatusCode = 200): Response {
  return c.json(data, status);
}

export async function validJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  const result = schema.safeParse(await c.req.json());
  if (!result.success) {
    throw new HTTPException(400, { message: result.error.message });
  }
  return result.data;
}

export function unauthorized(): never {
  throw new HTTPException(401, { message: "Unauthorized" });
}

export function forbidden(): never {
  throw new HTTPException(403, { message: "Forbidden" });
}

export function notFound(message = "Not found"): never {
  throw new HTTPException(404, { message });
}

export async function currentProjectRole(projectId: string): Promise<ProjectRole | null> {
  const { db, user } = getStore();
  if (!user) {
    return null;
  }
  return await new MemberModel(db).effectiveRole(user.role, projectId, user.id);
}

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

export async function findProjectBySlug(slug: string): Promise<Project | null> {
  const { db } = getStore();
  const rows = await db.list(projects, { where: eq(projects.slug, slug), limit: 1 });
  return rows[0] ?? null;
}

export async function resolveProject(c: Context, slug: string): Promise<Project> {
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
  const project = await findProjectBySlug(slug);
  if (!project) {
    notFound("Project not found");
  }
  return project;
}
