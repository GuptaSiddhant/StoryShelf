import type { DatabaseAdapter } from "../adapters/database.ts";
import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import type { Build } from "../schema/build.ts";
import type { Project } from "../schema/project.ts";

export async function createTestProject(
  db: DatabaseAdapter,
  overrides?: Partial<Project>,
): Promise<Project> {
  const { gitRepository: repo, ...rest } = overrides ?? {};
  const gitRepository = repo ?? "owner/repo";
  return await new ProjectModel(db).create({ name: "Test", gitRepository, ...rest });
}

export async function createTestBuild(
  db: DatabaseAdapter,
  projectId: string,
  overrides?: Partial<Build>,
): Promise<Build> {
  return await new BuildModel(db).create(projectId, {
    gitSha: "sha-1",
    gitBranch: "main",
    ...overrides,
  } as Parameters<BuildModel["create"]>[1]);
}
