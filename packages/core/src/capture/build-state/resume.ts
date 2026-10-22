/**
 * Re-requesting the state of builds still open. Requests made while no public origin was resolved
 * were dropped (ADR 0014, decision 11), so once one is, the builds that can still change are asked
 * again; settled builds keep what they last showed until their next transition.
 */
import { BuildModel } from "../../models/build.ts";
import { ProjectModel } from "../../models/project.ts";
import type { BuildStatus } from "../../types.ts";
import type { BuildStateDeps, BuildStatePublisher } from "./types.ts";

/** Builds that have not reached a verdict. */
const OPEN: ReadonlySet<BuildStatus> = new Set(["pending", "capturing", "comparing", "reviewing"]);

/** Newest builds looked at per project. */
const PER_PROJECT = 25;

/** Ask `publisher` for the state of every open recent build; resolves to how many were asked. Never rejects. */
export async function requestOpenBuildStates(
  deps: Pick<BuildStateDeps, "db" | "logger">,
  publisher: BuildStatePublisher,
): Promise<number> {
  try {
    const projects = await new ProjectModel(deps.db).list();
    const lists = await Promise.all(
      projects.map(async (project) => await openBuildIds(deps, project.id)),
    );
    const ids = lists.flat();
    await Promise.all(
      ids.map(async (id) => {
        await publisher.request(id);
      }),
    );
    return ids.length;
  } catch (error) {
    deps.logger.warn({ err: error }, "failed to re-request the state of open builds");
    return 0;
  }
}

/** The newest builds of a project that have not reached a verdict. */
async function openBuildIds(
  deps: Pick<BuildStateDeps, "db">,
  projectId: string,
): Promise<string[]> {
  const recent = await new BuildModel(deps.db).list(projectId, { limit: PER_PROJECT });
  return recent.filter((build) => OPEN.has(build.status)).map((build) => build.id);
}
