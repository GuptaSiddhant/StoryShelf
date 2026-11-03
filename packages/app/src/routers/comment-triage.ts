/** Who may resolve or reopen a comment (ADR 0013): developers and above, and the build's own author. */
import type { Build, Project } from "@storyshelf/core/schema";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { getStore } from "../store.ts";
import { DEVELOPER_ROLES, VIEW_ROLES, buildForProject } from "./builds.handlers.ts";
import { forbidden, resolveAuthorizedProject } from "./helpers.ts";

/**
 * The project and build of a resolve or reopen. A developer, approver or admin may; so may the
 * author of the build (the signed-in user whose email is the build's git author) even when they
 * only view the project. Anyone else gets 403.
 */
export async function resolveTriager(
  c: Context,
  slug: string,
  buildId: string,
): Promise<{ project: Project; build: Build }> {
  try {
    const project = await resolveAuthorizedProject(c, slug, ...DEVELOPER_ROLES);
    return { project, build: await buildForProject(project.id, buildId) };
  } catch (error) {
    if (!(error instanceof HTTPException) || error.status !== 403) {
      throw error;
    }
  }
  const project = await resolveAuthorizedProject(c, slug, ...VIEW_ROLES);
  const build = await buildForProject(project.id, buildId);
  if (!isBuildAuthor(build)) {
    forbidden();
  }
  return { project, build };
}

/** Whether the signed-in user is the author of `build` (their email is the build's git author). */
export function isBuildAuthor(build: Pick<Build, "authorEmail">): boolean {
  const email = getStore().user?.email?.toLowerCase();
  return email !== undefined && email === build.authorEmail?.toLowerCase();
}
