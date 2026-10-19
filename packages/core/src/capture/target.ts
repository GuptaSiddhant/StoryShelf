import type { DatabaseAdapter } from "../adapters/database.ts";
import { BuildModel, type BuildTables } from "../models/build.ts";
import { ProjectModel, type ProjectTables } from "../models/project.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";

/** Load a build and its project, throwing when either is gone. */
export async function loadTarget(
  options: { db: DatabaseAdapter; tables: BuildTables & ProjectTables },
  buildId: string,
): Promise<{ build: Build; project: Project }> {
  const build = await new BuildModel(options.db, options.tables).get(buildId);
  if (!build) {
    throw new Error(`Build not found: ${buildId}`);
  }
  const project = await new ProjectModel(options.db, options.tables).get(build.projectId);
  if (!project) {
    throw new Error(`Project not found: ${build.projectId}`);
  }
  return { build, project };
}
