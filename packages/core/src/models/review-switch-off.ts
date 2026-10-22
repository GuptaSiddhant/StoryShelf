/**
 * The switch-off pass (ADR 0013, decision 1): when a project turns review off, the builds it left
 * `pending` that no capture ever worked on are accepted in one pass, so the project does not keep
 * a queue nobody will clear.
 */
import type { DatabaseAdapter } from "../adapters/database.ts";
import type { Build } from "../schema/build.ts";
import { BuildModel } from "./build.ts";
import { CaptureAttemptModel } from "./capture-attempt.ts";
import { SnapshotModel } from "./snapshot.ts";

/**
 * Accept the project's `pending` builds that have no capture attempts and no snapshots; resolves
 * to the builds it accepted. Builds a capture touched keep their status (snapshot approval decides
 * them), and a second run finds nothing left to do. No approval event is raised.
 */
export async function acceptPendingWithoutWork(
  db: DatabaseAdapter,
  projectId: string,
): Promise<Build[]> {
  const builds = new BuildModel(db);
  const pending = await builds.list(projectId, { status: "pending" });
  const idle = await Promise.all(
    pending.map(async (build) => ((await hasWork(db, build.id)) ? null : build)),
  );
  return await Promise.all(
    idle.flatMap((build) => (build === null ? [] : [builds.setStatus(build.id, "approved")])),
  );
}

async function hasWork(db: DatabaseAdapter, buildId: string): Promise<boolean> {
  const [attempts, snapshots] = await Promise.all([
    new CaptureAttemptModel(db).listByBuild(buildId),
    new SnapshotModel(db).listByBuild(buildId),
  ]);
  return attempts.length > 0 || snapshots.length > 0;
}
