import type { DatabaseAdapter } from "../adapters/database.ts";
import { BuildModel, type BuildTables } from "../models/build.ts";

/** Skip capture when another approved build already covers the same commit. */
export async function hasApprovedBuildForSha(
  db: DatabaseAdapter,
  tables: BuildTables,
  projectId: string,
  sha: string,
  excludeBuildId: string,
): Promise<boolean> {
  const approved = await new BuildModel(db, tables).list(projectId, { status: "approved" });
  return approved.some((build) => build.gitSha === sha && build.id !== excludeBuildId);
}
