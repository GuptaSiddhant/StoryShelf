/** Data for the build-review insight panel (null when AI is off for the project). */
import { InsightModel } from "@storyshelf/core/models";
import type { Build, Project } from "@storyshelf/core/schema";
import { APPROVER_ROLES } from "../routers/builds.handlers.ts";
import { currentProjectRole } from "../routers/helpers.ts";
import { getStore } from "../store.ts";
import { toInsightView, type InsightView } from "./view.ts";

/** What the panel shows. */
export interface InsightPanelData {
  latest: InsightView | null;
  canGenerate: boolean;
}

/** Load the panel for a build, or null when AI is off site-wide or for the project. */
export async function loadInsightPanel(
  project: Project,
  build: Build,
): Promise<InsightPanelData | null> {
  const { ai, db, authEnabled } = getStore();
  if (!ai || project.aiProfile === null || project.aiProfile === undefined) {
    return null;
  }
  const [latest] = await new InsightModel(db).listForBuild(build.id, 1);
  const role = authEnabled ? await currentProjectRole(project.id) : "admin";
  return {
    latest: latest ? toInsightView(latest) : null,
    canGenerate: role !== null && (APPROVER_ROLES as readonly string[]).includes(role),
  };
}
