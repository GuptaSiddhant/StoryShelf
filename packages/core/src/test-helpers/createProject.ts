import { BuildModel } from "../models/build.ts";
import { ProjectModel } from "../models/project.ts";
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Build, Project } from "../schema.ts";

export async function createTestProject(db: DatabaseAdapter, overrides?: Partial<Project>): Promise<Project> {
  return await new ProjectModel(db).create({ name: "Test", gitRepository: "owner/repo", ...overrides });
}

export async function createTestBuild(db: DatabaseAdapter, projectId: string, overrides?: Partial<Build>): Promise<Build> {
  return await new BuildModel(db).create(projectId, { gitSha: "sha-1", gitBranch: "main", ...overrides });
}