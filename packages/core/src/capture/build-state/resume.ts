/**
 * Re-requesting the state of builds still open. Requests made while no public origin was resolved
 * were dropped (ADR 0014, decision 11), so once one is, the builds that can still change are asked
 * again; settled builds keep what they last showed until their next transition.
 */
import { LOCAL_SHA_PREFIX } from "@storyshelf/affected";
import { BuildModel } from "../../models/build.ts";
import { ProjectModel } from "../../models/project.ts";
import type { BuildStatus } from "../../types.ts";
import type { BuildStateDeps, BuildStatePublisher } from "./types.ts";

/** Builds that have not reached a verdict. */
const OPEN: ReadonlySet<BuildStatus> = new Set(["pending", "capturing", "comparing", "reviewing"]);

/** Newest builds looked at per project. */
const PER_PROJECT = 25;

/** Narrows {@link requestOpenBuildStates}: one project, and within it one git channel. */
export interface OpenBuildScope {
  projectId?: string;
  /** Only this channel is asked (an operator retry); other channels keep what they show. */
  channelId?: string;
}

/** How a request for open builds ended: how many were asked, or that the lookup itself failed. */
export type OpenBuildRequest = { ok: true; asked: number } | { ok: false };

/**
 * Ask `publisher` for the state of every open recent build (of `scope`, when given). Never rejects:
 * a failed lookup is logged once and answered `{ ok: false }`, so a caller that reports to a person
 * (an operator retry) can tell it from "nothing is open".
 */
export async function tryRequestOpenBuildStates(
  deps: Pick<BuildStateDeps, "db" | "logger">,
  publisher: BuildStatePublisher,
  scope: OpenBuildScope = {},
): Promise<OpenBuildRequest> {
  try {
    const projects = (await new ProjectModel(deps.db).list()).filter(
      (project) => scope.projectId === undefined || project.id === scope.projectId,
    );
    const lists = await Promise.all(
      projects.map(async (project) => await openBuildIds(deps, project.id)),
    );
    const ids = lists.flat();
    const { channelId } = scope;
    await Promise.all(
      ids.map(async (id) => {
        await (channelId === undefined
          ? publisher.request(id)
          : publisher.request(id, { channelId }));
      }),
    );
    return { ok: true, asked: ids.length };
  } catch (error) {
    deps.logger.warn({ err: error }, "failed to re-request the state of open builds");
    return { ok: false };
  }
}

/**
 * Ask `publisher` for the state of every open recent build (of `scope`, when given); resolves to
 * how many builds were asked, 0 when the lookup failed. Never rejects: the boot replay and an
 * origin change must not fail because of it.
 */
export async function requestOpenBuildStates(
  deps: Pick<BuildStateDeps, "db" | "logger">,
  publisher: BuildStatePublisher,
  scope: OpenBuildScope = {},
): Promise<number> {
  const result = await tryRequestOpenBuildStates(deps, publisher, scope);
  return result.ok ? result.asked : 0;
}

/** The newest builds of a project that have not reached a verdict. */
async function openBuildIds(
  deps: Pick<BuildStateDeps, "db">,
  projectId: string,
): Promise<string[]> {
  const recent = await new BuildModel(deps.db).list(projectId, { limit: PER_PROJECT });
  return recent
    .filter((build) => OPEN.has(build.status) && hasGitCommit(build.gitSha))
    .map((build) => build.id);
}

/** A build with no commit, or a local upload, has no git state to show (see `statusesForBuild`). */
function hasGitCommit(gitSha: string): boolean {
  return gitSha.length > 0 && !gitSha.startsWith(LOCAL_SHA_PREFIX);
}
