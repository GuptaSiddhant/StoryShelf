import type { DatabaseAdapter } from "../db/database.ts";
import { BuildModel, type BuildTables } from "../models/build.ts";
import { ProjectModel, type ProjectTables } from "../models/project.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";

/** Create a test project with owner/repo defaults. */
export async function createTestProject(
  db: DatabaseAdapter,
  tables: ProjectTables,
  overrides?: Partial<Project>,
): Promise<Project> {
  const { gitRepository: repo, ...rest } = overrides ?? {};
  const gitRepository = repo ?? "owner/repo";
  return await new ProjectModel(db, tables).create({ name: "Test", gitRepository, ...rest });
}

/** Create a test build on main with sha-1 defaults. */
export async function createTestBuild(
  db: DatabaseAdapter,
  tables: BuildTables,
  projectId: string,
  overrides?: Partial<Build>,
): Promise<Build> {
  return await new BuildModel(db, tables).create(projectId, {
    gitSha: "sha-1",
    gitBranch: "main",
    ...overrides,
  } as Parameters<BuildModel["create"]>[1]);
}
