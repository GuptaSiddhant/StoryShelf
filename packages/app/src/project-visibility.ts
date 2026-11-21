/**
 * Which projects a person may see listed. A project you have no role on does not exist as far
 * as you can tell (its pages and API answer 404, `projectHidden`), so no user-facing list may name
 * it either. Admin-only and background callers keep `ProjectModel.list()` unfiltered.
 */
import type { DatabaseAdapter } from "@storyshelf/core/adapter/database";
import { MemberModel } from "@storyshelf/core/models";
import { ProjectModel } from "@storyshelf/core/models";
import type { Project } from "@storyshelf/core/schema";
import type { AuthUser } from "@storyshelf/core/types";
import { getStore } from "./store.ts";

/** Who is asking: whether auth is on and the signed-in user, if any. */
export interface ProjectViewer {
  authEnabled: boolean;
  user: AuthUser | null;
}

/**
 * The projects `viewer` can open: every project with auth off or for a site admin, otherwise
 * those where `MemberModel.effectiveRole` gives a role (a site viewer reads every project). With
 * auth on and no signed-in user, none.
 */
export async function visibleProjects(
  db: DatabaseAdapter = getStore().db,
  viewer: ProjectViewer = getStore(),
): Promise<Project[]> {
  const projects = await new ProjectModel(db).list();
  return await filterVisible(db, viewer, projects);
}

/** `projects` narrowed to those `viewer` has an effective role on, order kept. */
export async function filterVisible(
  db: DatabaseAdapter,
  { authEnabled, user }: ProjectViewer,
  projects: readonly Project[],
): Promise<Project[]> {
  if (!authEnabled || user?.role === "admin") {
    return [...projects];
  }
  if (!user) {
    return [];
  }
  const members = new MemberModel(db);
  const roles = await Promise.all(
    projects.map(async (project) => await members.effectiveRole(user.role, project.id, user.id)),
  );
  return projects.filter((_project, index) => roles[index] !== null);
}
