/**
 * GitLab: statuses a build posts join the commit's pipeline, so the merge gate is the project's
 * "pipelines must succeed" setting (`only_allow_merge_if_pipeline_succeeds`). GitLab has no
 * per-status required-check list outside its paid external status checks.
 */
import {
  HostError,
  hostJson,
  type Fetch,
  type ProtectionAdapter,
  type ProtectionResult,
  type ProtectionTarget,
} from "./protect-types.ts";

interface Project {
  only_allow_merge_if_pipeline_succeeds?: boolean;
}

/** The GitLab adapter for the project `group/project` on `host`. */
export function gitlabProtection(repo: string, host: string, fetchImpl: Fetch): ProtectionAdapter {
  const api = `${host.replace(/\/+$/u, "")}/api/v4/projects/${encodeURIComponent(repo)}`;
  return {
    tokenEnv: "GITLAB_TOKEN",
    manualSteps: (target) => manualSteps(repo, host, target),
    inspect: async (target, token) => await inspect({ api, fetchImpl, token }, target),
  };
}

function manualSteps(repo: string, host: string, target: ProtectionTarget): string[] {
  return [
    `GitLab: make ${target.checks.join(", ")} gate merges into ${target.branch} on ${repo}:`,
    "",
    `1. Open ${host.replace(/\/+$/u, "")}/${repo}/-/settings/merge_requests.`,
    '2. Under "Merge checks" tick "Pipelines must succeed". The commit statuses StoryShelf posts',
    "   are part of the commit's pipeline, so a failed or pending one blocks the merge.",
    `3. Open Settings > Repository > Protected branches and protect ${target.branch} (merge via merge request).`,
    "4. Token scope: api, with the Maintainer role.",
  ];
}

interface Ctx {
  api: string;
  fetchImpl: Fetch;
  token: string;
}

async function inspect(ctx: Ctx, target: ProtectionTarget): Promise<ProtectionResult> {
  const headers = { "private-token": ctx.token };
  const project = await hostJson<Project>(ctx.fetchImpl, ctx.api, { headers });
  const protectedBranch = await isProtected(ctx, target.branch);
  const setting = project.only_allow_merge_if_pipeline_succeeds === true;
  const branchNote = protectedBranch
    ? ""
    : ` Branch ${target.branch} is not protected: protect it by hand.`;
  if (setting) {
    return {
      satisfied: protectedBranch,
      summary: `Pipelines must succeed is on.${branchNote}`,
    };
  }
  return {
    satisfied: false,
    summary: `"Pipelines must succeed" is off, so ${target.checks.join(", ")} does not gate merges.${branchNote}`,
    apply: async () => {
      await hostJson(ctx.fetchImpl, ctx.api, {
        method: "PUT",
        headers,
        json: { only_allow_merge_if_pipeline_succeeds: true },
      });
      return `Turned on "Pipelines must succeed".${branchNote}`;
    },
  };
}

async function isProtected(ctx: Ctx, branch: string): Promise<boolean> {
  try {
    await hostJson(ctx.fetchImpl, `${ctx.api}/protected_branches/${encodeURIComponent(branch)}`, {
      headers: { "private-token": ctx.token },
    });
    return true;
  } catch (error) {
    if (error instanceof HostError && error.status === 404) {
      return false;
    }
    throw error;
  }
}
