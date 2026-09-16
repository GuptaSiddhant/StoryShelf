import type { Logger } from "@storyshelf/core/logger";
/* oxlint-disable max-statements, max-lines-per-function */
import { httpJson } from "@storyshelf/core/utils";
import { apiBase, gitlabHeaders, projectId } from "./helpers.ts";
import { findMrIid } from "./pr.ts";

interface MergeRequestDetail {
  state?: string;
  merged_at?: string | null;
}

interface MergeRequestRef {
  sha?: string;
  merge_commit_sha?: string | null;
}

/** Check whether the merge request for a commit SHA has been merged. */
export async function checkIsMerged(opts: {
  owner: string;
  repo: string;
  host: string | undefined;
  token: string;
  sha: string;
  branch: string;
  logger?: Logger;
}): Promise<boolean> {
  try {
    const iid = await findMrIid({
      host: opts.host,
      owner: opts.owner,
      repo: opts.repo,
      token: opts.token,
      sha: opts.sha,
    });
    const base = apiBase(opts.host);
    const pid = projectId(opts.owner, opts.repo);
    if (iid !== undefined) {
      const mr = await httpJson<MergeRequestDetail>(
        `${base}/api/v4/projects/${pid}/merge_requests/${iid}`,
        { headers: gitlabHeaders(opts.token) },
      );
      return mr.state === "merged" || (mr.merged_at !== null && mr.merged_at !== undefined); // oxlint-disable-line eslint/no-eq-null, eslint/eqeqeq
    }
    const mrs = await httpJson<MergeRequestRef[]>(
      `${base}/api/v4/projects/${pid}/merge_requests?state=merged&source_branch=${encodeURIComponent(opts.branch)}&per_page=5`,
      { headers: gitlabHeaders(opts.token) },
    );
    return mrs.some((mr) => mr.sha === opts.sha || mr.merge_commit_sha === opts.sha);
  } catch (error) {
    opts.logger?.debug(
      { err: error, sha: opts.sha, branch: opts.branch },
      "isMerged check failed, not skipping",
    );
    return false;
  }
}
