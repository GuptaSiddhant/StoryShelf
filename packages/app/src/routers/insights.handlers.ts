import type { Project } from "@storyshelf/core/schema";
/** Shared guards for the insights API (ADR 0016 §6 guard order). */
import type { Context } from "hono";
import { insightDepsFromStore, type InsightDeps } from "../insights/deps.ts";
import { failWith } from "../insights/errors.ts";
import { getStore } from "../store.ts";
import { APPROVER_ROLES, VIEW_ROLES } from "./builds.handlers.ts";
import { requestHasAdminToken, resolveAuthorizedProject } from "./helpers.ts";

/** AI deps or `501 ai-disabled` when the site has no AI configured. */
export function requireAi(): InsightDeps {
  const deps = insightDepsFromStore();
  if (!deps) {
    failWith(501, "ai-disabled");
  }
  return deps;
}

/** `409 ai-disabled-for-project` unless the project selected a profile. */
export function requireProjectAi(project: Project): void {
  if (project.aiProfile === null || project.aiProfile === undefined) {
    failWith(409, "ai-disabled-for-project");
  }
}

/** Whether the caller is a site admin (or auth is off / bootstrap admin token). */
export function isSiteAdmin(c: Context): boolean {
  const store = getStore();
  return !store.authEnabled || store.user?.role === "admin" || requestHasAdminToken(c);
}

/** Resolve a project for reading insights (all four roles). */
export async function projectForView(
  c: Context,
  slug: string,
): Promise<{ deps: InsightDeps; project: Project }> {
  const deps = requireAi();
  const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
  return { deps, project };
}

/** Resolve a project for regenerating (approver + admin) in the ADR guard order. */
export async function projectForRegenerate(
  c: Context,
  slug: string,
): Promise<{ deps: InsightDeps; project: Project }> {
  const { deps, project } = await projectForView(c, slug);
  requireProjectAi(project);
  if (!requestHasAdminToken(c)) {
    // Resolves the caller the same way as the view check (a project token or the session), so a
    // token holder with too low a role gets 403 and a caller with no role at all gets 404.
    await resolveAuthorizedProject(c, slug, ...APPROVER_ROLES);
  }
  return { deps, project };
}
